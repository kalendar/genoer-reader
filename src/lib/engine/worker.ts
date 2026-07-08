/**
 * Inference Web Worker — the ONE place in the app that imports
 * `@huggingface/transformers` (SPEC.md §5: engine sits behind a thin interface;
 * nothing outside `src/lib/engine/` touches the library directly).
 *
 * Responsibilities:
 *  - load exactly the (model, backend, dtype) it is told to, once;
 *  - stream generated text back chunk-by-chunk via the {@link WorkerResponse}
 *    protocol so the UI never blocks;
 *  - support interruption (abort) mid-generation;
 *  - report failures with the raw error message and stop.
 *
 * Deliberately NO retry/fallback logic lives here: a wasm trap ("memory access
 * out of bounds") or a failed giant load corrupts this worker's runtime and
 * heap permanently (wasm memory never shrinks), so recovery inside the same
 * worker is doomed. `transformers-engine.ts` owns the recovery ladder — it
 * terminates this worker and retries in a FRESH one.
 *
 * Real inference can't be exercised headless — this file is verified only for
 * type/compile correctness in CI; behaviour needs a browser.
 */
import {
	pipeline,
	TextStreamer,
	InterruptableStoppingCriteria,
	type TextGenerationPipeline
} from '@huggingface/transformers';
import type { Backend, LoadProgress } from './types';
import type { WorkerRequest, WorkerResponse } from './protocol';

const ctx = self as unknown as Worker;

function post(msg: WorkerResponse): void {
	ctx.postMessage(msg);
}

/**
 * Default weight variant when the caller doesn't pin one: always q4 (fp32
 * compute). Even on adapters that advertise shader-f16, the fp16 WebGPU
 * execution path in current onnxruntime-web crashes at inference (SafeInt
 * overflow in OrtRun) — field-confirmed on Chrome/macOS 2026-07-08. Revisit
 * q4f16 as the default when a fixed runtime ships.
 */
function defaultDtype(): string {
	return 'q4';
}

/** Probe WebGPU the same way the capability probe does, but from inside the worker. */
async function resolveBackend(requested?: Backend | 'auto'): Promise<Backend> {
	if (requested === 'wasm') return 'wasm';
	const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
	if (!gpu) return 'wasm';
	try {
		const adapter = await gpu.requestAdapter();
		if (adapter) return 'webgpu';
	} catch {
		/* fall through to wasm */
	}
	return 'wasm';
}

// A single loaded model lives for the worker's lifetime; loading a new model
// replaces it. `activeStopper` lets an abort message interrupt generation.
let generator: TextGenerationPipeline | null = null;
let activeStopper: InterruptableStoppingCriteria | null = null;
/** Repo id of the loaded model — used for model-family prompt quirks. */
let currentModelId: string | null = null;

async function handleLoad(id: number, modelId: string, dtype?: string, device?: Backend | 'auto') {
	const backend = await resolveBackend(device);
	const chosenDtype = dtype ?? defaultDtype();

	// Dispose the previous pipeline FIRST — replacing the reference without
	// disposing leaks the old model's sessions (multi-GB); loading a second
	// model on top of an undisposed first one fails with std::bad_alloc.
	if (generator) {
		try {
			await (generator as unknown as { dispose?: () => Promise<void> }).dispose?.();
		} catch {
			/* disposal is best-effort — proceed to load regardless */
		}
		generator = null;
	}

	generator = (await pipeline('text-generation', modelId, {
		device: backend,
		dtype: chosenDtype as never,
		progress_callback: (p: unknown) => {
			post({ type: 'load-progress', id, progress: p as LoadProgress });
		}
	})) as unknown as TextGenerationPipeline;
	currentModelId = modelId;

	post({ type: 'ready', id, backend, modelId });
}

async function handleGenerate(
	id: number,
	messages: { role: string; content: string }[],
	options?: { maxNewTokens?: number; temperature?: number; topP?: number }
) {
	if (!generator) {
		post({ type: 'error', id, message: 'No model loaded' });
		return;
	}

	const tokenizer = generator.tokenizer;
	const started = performance.now();

	// Thinking suppression, belt and braces (Qwen3-family models otherwise
	// burn the whole max_new_tokens budget on a hidden <think> phase):
	// 1. render the chat template with enable_thinking:false — the same
	//    mechanism HF's official Qwen3 WebGPU demo uses on this exact runtime
	//    version (an earlier crash was misattributed to this path; the actual
	//    culprit was the since-pinned-away transformers.js 4.2.0 runtime);
	// 2. append Qwen3's documented "/no_think" soft switch to the user turn;
	// 3. the stream filter below strips any residual think content.
	const isQwen3 = /qwen3/i.test(currentModelId ?? '');
	const genMessages =
		isQwen3 && messages.length > 0 && messages[messages.length - 1].role === 'user'
			? [
					...messages.slice(0, -1),
					{
						...messages[messages.length - 1],
						content: messages[messages.length - 1].content + ' /no_think'
					}
				]
			: messages;

	let prompt: string | null = null;
	if (isQwen3) {
		try {
			prompt = tokenizer.apply_chat_template(genMessages as never, {
				add_generation_prompt: true,
				tokenize: false,
				enable_thinking: false
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			} as any) as unknown as string;
			if (typeof prompt !== 'string') prompt = null;
		} catch {
			prompt = null;
		}
	}

	// Prompt token count via the model's own chat template — accurate, cheap.
	let promptTokens = 0;
	try {
		if (prompt) {
			const enc = tokenizer(prompt) as unknown as { input_ids?: { size?: number } };
			promptTokens = enc?.input_ids?.size ?? Math.ceil(prompt.length / 4);
		} else {
			const ids = tokenizer.apply_chat_template(genMessages as never, {
				add_generation_prompt: true,
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			} as any) as unknown as { length?: number } | number[];
			promptTokens = Array.isArray(ids) ? ids.length : (ids?.length ?? 0);
		}
	} catch {
		promptTokens = 0;
	}

	let generated = '';
	// Belt-and-braces: even with enable_thinking:false, strip any
	// <think>…</think> content so reasoning never reaches the UI.
	let inThink = false;
	const emit = (text: string) => {
		if (!text) return;
		generated += text;
		post({ type: 'chunk', id, text });
	};
	const filterThink = (raw: string) => {
		let text = raw;
		while (text) {
			if (inThink) {
				const end = text.indexOf('</think>');
				if (end === -1) return;
				text = text.slice(end + '</think>'.length).replace(/^\s+/, '');
				inThink = false;
			} else {
				const start = text.indexOf('<think>');
				if (start === -1) {
					emit(text);
					return;
				}
				emit(text.slice(0, start));
				text = text.slice(start + '<think>'.length);
				inThink = true;
			}
		}
	};

	const streamer = new TextStreamer(tokenizer, {
		skip_prompt: true,
		skip_special_tokens: true,
		callback_function: filterThink
	});
	const stopper = new InterruptableStoppingCriteria();
	activeStopper = stopper;

	try {
		await generator((prompt ?? genMessages) as never, {
			max_new_tokens: options?.maxNewTokens ?? 512,
			do_sample: (options?.temperature ?? 0) > 0,
			temperature: options?.temperature ?? 0.7,
			top_p: options?.topP ?? 0.9,
			streamer,
			stopping_criteria: stopper,
			return_full_text: false
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any);
	} catch (err) {
		// Raw error only — the engine decides whether/how to recover.
		post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
		activeStopper = null;
		return;
	}

	const elapsedMs = performance.now() - started;
	let completionTokens = 0;
	try {
		const enc = tokenizer(generated) as unknown as { input_ids?: { size?: number } };
		completionTokens = enc?.input_ids?.size ?? Math.ceil(generated.length / 4);
	} catch {
		completionTokens = Math.ceil(generated.length / 4);
	}

	activeStopper = null;
	post({
		type: 'done',
		id,
		usage: {
			promptTokens,
			completionTokens,
			totalTokens: promptTokens + completionTokens,
			elapsedMs,
			tokensPerSecond: elapsedMs > 0 ? (completionTokens / elapsedMs) * 1000 : 0
		}
	});
}

ctx.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
	const msg = event.data;
	switch (msg.type) {
		case 'load':
			handleLoad(msg.id, msg.modelId, msg.dtype, msg.device).catch((err) =>
				post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) })
			);
			break;
		case 'generate':
			handleGenerate(msg.id, msg.messages, msg.options).catch((err) =>
				post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) })
			);
			break;
		case 'abort':
			activeStopper?.interrupt();
			break;
	}
});
