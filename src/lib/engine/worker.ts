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
function defaultDtype(backend: Backend): string {
	// q4f16 needs fp16 shaders (WebGPU); on WASM fall back to a plain q4.
	return backend === 'webgpu' ? 'q4f16' : 'q4';
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

async function handleLoad(id: number, modelId: string, dtype?: string, device?: Backend | 'auto') {
	const backend = await resolveBackend(device);
	const chosenDtype = dtype ?? defaultDtype(backend);

	generator = (await pipeline('text-generation', modelId, {
		device: backend,
		dtype: chosenDtype as never,
		progress_callback: (p: unknown) => {
			post({ type: 'load-progress', id, progress: p as LoadProgress });
		}
	})) as unknown as TextGenerationPipeline;

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

	// Prompt token count via the model's own chat template — accurate, cheap.
	let promptTokens = 0;
	try {
		const ids = tokenizer.apply_chat_template(messages as never, {
			add_generation_prompt: true,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any) as unknown as { length?: number } | number[];
		promptTokens = Array.isArray(ids) ? ids.length : (ids?.length ?? 0);
	} catch {
		promptTokens = 0;
	}

	let generated = '';
	const streamer = new TextStreamer(tokenizer, {
		skip_prompt: true,
		skip_special_tokens: true,
		callback_function: (text: string) => {
			generated += text;
			post({ type: 'chunk', id, text });
		}
	});

	const stopper = new InterruptableStoppingCriteria();
	activeStopper = stopper;

	try {
		await generator(messages as never, {
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
