/**
 * Engine interface (SPEC.md §5) — a thin, engine-agnostic contract for
 * on-device chat completion.
 *
 * The whole point of this file is that *nothing outside `src/lib/engine/`
 * imports `@huggingface/transformers` directly*. Features (chat UI, study
 * tools) depend only on these types and on `createEngine()`. Transformers.js
 * v4 is the only implementation today (`transformers-engine.ts` + `worker.ts`),
 * but a second engine (e.g. wllama for "bring your own GGUF", SPEC §5
 * "Alternatives considered") could be dropped in behind the same interface
 * without touching a single feature.
 */

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
	role: ChatRole;
	content: string;
}

/** Which compute backend the model is actually running on. */
export type Backend = 'webgpu' | 'wasm';

/**
 * Progress of a model download/initialisation. Mirrors the shape Transformers.js
 * emits from its `progress_callback`, plus an `overall` fraction (0–1) the engine
 * derives across all files so the UI can show a single bar.
 */
export interface LoadProgress {
	status: 'initiate' | 'download' | 'progress' | 'done' | 'ready' | string;
	/** File currently downloading, e.g. "onnx/model_q4f16.onnx". */
	file?: string;
	/** Bytes loaded / total for the current file. */
	loaded?: number;
	total?: number;
	/** Per-file fraction 0–100 (as Transformers.js reports it). */
	progress?: number;
	/** Engine-derived overall fraction across all tracked files, 0–1. */
	overall?: number;
}

export interface LoadOptions {
	/** ONNX weight variant to fetch, e.g. "q4", "q4f16", "int8". Engine picks a
	 * backend-appropriate default when omitted. */
	dtype?: string;
	/** Force a backend; omit or 'auto' to let the engine probe WebGPU → WASM. */
	device?: Backend | 'auto';
	/** Context-window ceiling the retrieval pipeline was budgeted against. */
	maxContext?: number;
}

export interface GenerateOptions {
	maxNewTokens?: number;
	temperature?: number;
	topP?: number;
}

/** Reported once a generation finishes (the "final usage" of the stream). */
export interface Usage {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	elapsedMs: number;
	tokensPerSecond: number;
}

/**
 * A live generation: async-iterate it for text chunks; await `.usage` for the
 * final token counts and measured tokens/sec; call `.abort()` to stop early.
 */
export interface ChatStream extends AsyncIterable<string> {
	usage: Promise<Usage>;
	abort(): void;
}

export interface LoadResult {
	backend: Backend;
	modelId: string;
}

export interface Engine {
	/**
	 * Download (if needed) and initialise a model. `onProgress` fires repeatedly
	 * during download. Resolves with the backend that ended up active.
	 */
	loadModel(
		modelId: string,
		opts?: LoadOptions,
		onProgress?: (p: LoadProgress) => void
	): Promise<LoadResult>;
	/** Start a streaming chat completion. Retrieval/prompting happen upstream. */
	chat(messages: ChatMessage[], opts?: GenerateOptions): ChatStream;
	/** Approximate token count (SPEC §5 says "approx") — used for context budgeting. */
	countTokens(text: string): number;
	/** Tear down the worker and free the model. */
	dispose(): void;
	/**
	 * Fired when a failed generation was transparently retried on a safer
	 * (backend, dtype) config (SPEC §5 graceful degradation). UI should update
	 * its backend indicator and may surface a "compatibility mode" notice.
	 */
	onFallback?: (info: {
		from: { backend: Backend; dtype: string };
		to: { backend: Backend; dtype: string };
		reason: string;
	}) => void;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface EngineConfig {
	/** Reserved for future engine selection (e.g. 'transformers' | 'wllama'). */
	kind?: 'transformers';
}
