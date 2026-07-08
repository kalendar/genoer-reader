/**
 * Inference Web Worker — the ONE place in the app that imports
 * `@huggingface/transformers` (SPEC.md §5: engine sits behind a thin interface;
 * nothing outside `src/lib/engine/` touches the library directly).
 *
 * Responsibilities:
 *  - pick WebGPU when `navigator.gpu` resolves an adapter, else WASM/CPU, and
 *    report which backend is actually active (SPEC §5 "report which backend");
 *  - stream generated text back chunk-by-chunk via the {@link WorkerResponse}
 *    protocol so the UI never blocks;
 *  - support interruption (abort) mid-generation.
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

/** Sensible default weight variant per backend when the caller doesn't pin one. */
function defaultDtype(_backend: Backend, _f16: boolean): string {
	// Always q4 (fp32 compute): even on adapters that advertise shader-f16, the
	// fp16 WebGPU execution path in current onnxruntime-web crashes at inference
	// (SafeInt overflow in OrtRun) — field-confirmed on Chrome/macOS 2026-07-08.
	// Revisit q4f16 as the WebGPU default when a fixed runtime ships.
	return 'q4';
}

/** Probe WebGPU the same way the capability probe does, but from inside the worker. */
async function resolveBackend(
	requested?: Backend | 'auto'
): Promise<{ backend: Backend; f16: boolean }> {
	if (requested === 'wasm') return { backend: 'wasm', f16: false };
	const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
	if (!gpu) return { backend: 'wasm', f16: false };
	try {
		const adapter = await gpu.requestAdapter();
		if (adapter) return { backend: 'webgpu', f16: adapter.features.has('shader-f16') };
	} catch {
		/* fall through to wasm */
	}
	return { backend: 'wasm', f16: false };
}

// A single loaded model lives for the worker's lifetime; loading a new model
// replaces it. `activeStopper` lets an abort message interrupt generation.
let generator: TextGenerationPipeline | null = null;
let activeStopper: InterruptableStoppingCriteria | null = null;
/** Config the current pipeline was built with — the fallback ladder starts here. */
let current: {
	modelId: string;
	backend: Backend;
	dtype: string;
	/** Weight variants that exist in this repo; the ladder never guesses outside it. */
	available: string[];
} | null = null;

async function loadPipeline(
	modelId: string,
	backend: Backend,
	dtype: string,
	available: string[],
	progressId?: number
): Promise<void> {
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
		current = null;
	}
	generator = (await pipeline('text-generation', modelId, {
		device: backend,
		dtype: dtype as never,
		progress_callback:
			progressId === undefined
				? undefined
				: (p: unknown) => {
						post({ type: 'load-progress', id: progressId, progress: p as LoadProgress });
					}
	})) as unknown as TextGenerationPipeline;
	current = { modelId, backend, dtype, available };
}

/**
 * Next-safer (backend, dtype) after an inference failure. Known failure modes in
 * current onnxruntime-web: fp16/q4f16 execution on WebGPU can crash or overflow
 * (e.g. "SafeIntOnOverflow ... Integer overflow" from OrtRun) on some
 * browser/driver combinations, and large models can overflow 32-bit size math
 * as the KV cache grows. Only variants that actually exist in the repo are
 * tried (Qwen3-4B ships no q4 — a blind reload would 404). Weights already in
 * the browser cache make reloads cheap.
 */
function nextSaferConfig(c: { backend: Backend; dtype: string; available: string[] }) {
	const has = (d: string) => c.available.includes(d);
	if (c.backend === 'webgpu' && c.dtype !== 'q4' && has('q4'))
		return { backend: 'webgpu' as Backend, dtype: 'q4' };
	if (c.backend === 'webgpu' && has('q4')) return { backend: 'wasm' as Backend, dtype: 'q4' };
	if (c.backend === 'webgpu' && has('int8')) return { backend: 'wasm' as Backend, dtype: 'int8' };
	return null;
}

async function handleLoad(
	id: number,
	modelId: string,
	dtype?: string,
	device?: Backend | 'auto',
	availableDtypes?: string[]
) {
	const { backend, f16 } = await resolveBackend(device);
	const available = availableDtypes ?? [];
	let chosenDtype = dtype ?? defaultDtype(backend, f16);
	// The model registry pins q4f16 for GPU tiers; if this environment can't
	// actually run fp16 shaders, downgrade to a variant that exists rather than
	// letting inference fail later.
	if (chosenDtype === 'q4f16' && !(backend === 'webgpu' && f16) && available.includes('q4'))
		chosenDtype = 'q4';
	await loadPipeline(modelId, backend, chosenDtype, available, id);
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

	// Apply the chat template ourselves so we can pass enable_thinking:false —
	// Qwen3-family models otherwise open every answer with a <think>…</think>
	// block, which both delays the visible first token and leaks reasoning
	// into the response. Unknown template variables are ignored by non-thinking
	// models, so this is safe across the registry.
	let prompt: string | null = null;
	try {
		prompt = tokenizer.apply_chat_template(messages as never, {
			add_generation_prompt: true,
			tokenize: false,
			enable_thinking: false
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any) as unknown as string;
		if (typeof prompt !== 'string') prompt = null;
	} catch {
		prompt = null;
	}

	// Prompt token count via the model's own tokenizer — accurate, cheap.
	let promptTokens = 0;
	try {
		if (prompt) {
			const enc = tokenizer(prompt) as unknown as { input_ids?: { size?: number } };
			promptTokens = enc?.input_ids?.size ?? Math.ceil(prompt.length / 4);
		} else {
			const ids = tokenizer.apply_chat_template(messages as never, {
				add_generation_prompt: true,
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			} as any) as unknown as { length?: number } | number[];
			promptTokens = Array.isArray(ids) ? ids.length : (ids?.length ?? 0);
		}
	} catch {
		promptTokens = 0;
	}

	let generated = '';

	const attempt = async (): Promise<void> => {
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
		const streamer = new TextStreamer(generator!.tokenizer, {
			skip_prompt: true,
			skip_special_tokens: true,
			callback_function: filterThink
		});
		const stopper = new InterruptableStoppingCriteria();
		activeStopper = stopper;
		await generator!((prompt ?? messages) as never, {
			max_new_tokens: options?.maxNewTokens ?? 512,
			do_sample: (options?.temperature ?? 0) > 0,
			temperature: options?.temperature ?? 0.7,
			top_p: options?.topP ?? 0.9,
			streamer,
			stopping_criteria: stopper,
			return_full_text: false
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any);
	};

	// Attempt generation; on runtime failure BEFORE any text streamed, walk the
	// fallback ladder (webgpu+q4f16 → webgpu+q4 → wasm+q4), reloading the model
	// from the browser cache and retrying (SPEC §5: degraded, not absent).
	// Mid-stream failures are not retried — a retry would duplicate output.
	for (;;) {
		try {
			await attempt();
			break;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const safer = current && generated === '' ? nextSaferConfig(current) : null;
			if (!safer || !current) {
				const exhausted =
					current && generated === '' && current.backend === 'webgpu'
						? ` This model has no compatible fallback weight variant on this device — try a smaller model tier (the 1.7B and 0.5B models have broader fallback options).`
						: '';
				post({ type: 'error', id, message: message + exhausted });
				activeStopper = null;
				return;
			}
			post({
				type: 'fallback',
				id,
				from: { backend: current.backend, dtype: current.dtype },
				to: safer,
				reason: message
			});
			try {
				await loadPipeline(current.modelId, safer.backend, safer.dtype, current.available);
			} catch (reloadErr) {
				post({
					type: 'error',
					id,
					message: `Fallback reload failed: ${reloadErr instanceof Error ? reloadErr.message : String(reloadErr)} (original error: ${message})`
				});
				activeStopper = null;
				return;
			}
		}
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
			handleLoad(msg.id, msg.modelId, msg.dtype, msg.device, msg.availableDtypes).catch((err) =>
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
