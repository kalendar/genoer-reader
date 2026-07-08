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
function defaultDtype(backend: Backend, f16: boolean): string {
	// q4f16 needs fp16 shaders — actually CHECK for them (shader-f16), don't
	// assume every WebGPU adapter has them. On WASM (or fp16-less GPUs): plain q4.
	return backend === 'webgpu' && f16 ? 'q4f16' : 'q4';
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
let current: { modelId: string; backend: Backend; dtype: string } | null = null;

async function loadPipeline(
	modelId: string,
	backend: Backend,
	dtype: string,
	progressId?: number
): Promise<void> {
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
	current = { modelId, backend, dtype };
}

/**
 * Next-safer (backend, dtype) after an inference failure. Known failure mode in
 * current onnxruntime-web: fp16/q4f16 execution on WebGPU can crash or overflow
 * (e.g. "SafeIntOnOverflow ... Integer overflow" from OrtRun) on some
 * browser/driver combinations, while q4 (fp32 compute) and WASM work.
 * Weights are already in the browser cache, so reloads are cheap.
 */
function nextSaferConfig(c: { backend: Backend; dtype: string }) {
	if (c.backend === 'webgpu' && c.dtype !== 'q4') return { backend: 'webgpu' as Backend, dtype: 'q4' };
	if (c.backend === 'webgpu') return { backend: 'wasm' as Backend, dtype: 'q4' };
	return null;
}

async function handleLoad(id: number, modelId: string, dtype?: string, device?: Backend | 'auto') {
	const { backend, f16 } = await resolveBackend(device);
	let chosenDtype = dtype ?? defaultDtype(backend, f16);
	// The model registry pins q4f16 for GPU tiers; if this environment can't
	// actually run fp16 shaders, downgrade to q4 at load time rather than
	// letting inference fail later.
	if (chosenDtype === 'q4f16' && !(backend === 'webgpu' && f16)) chosenDtype = 'q4';
	await loadPipeline(modelId, backend, chosenDtype, id);
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

	const attempt = async (): Promise<void> => {
		const streamer = new TextStreamer(generator!.tokenizer, {
			skip_prompt: true,
			skip_special_tokens: true,
			callback_function: (text: string) => {
				generated += text;
				post({ type: 'chunk', id, text });
			}
		});
		const stopper = new InterruptableStoppingCriteria();
		activeStopper = stopper;
		await generator!(messages as never, {
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
				post({ type: 'error', id, message });
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
				await loadPipeline(current.modelId, safer.backend, safer.dtype);
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
