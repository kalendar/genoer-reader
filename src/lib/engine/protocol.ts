/**
 * Message protocol between the main thread and the inference Web Worker
 * (SPEC.md §5: "running in a Web Worker so generation never blocks the UI").
 *
 * Every request carries a monotonically increasing `id`; every worker→main
 * message that belongs to a request echoes that `id`, so `transformers-engine.ts`
 * can multiplex load, generate and abort over one worker.
 */
import type { Backend, ChatMessage, GenerateOptions, LoadProgress, Usage } from './types';

// ---- main → worker ----------------------------------------------------------

export interface LoadRequest {
	type: 'load';
	id: number;
	modelId: string;
	dtype?: string;
	device?: Backend | 'auto';
	/** Weight variants that exist in this repo — constrains the fallback ladder. */
	availableDtypes?: string[];
}

export interface GenerateRequest {
	type: 'generate';
	id: number;
	messages: ChatMessage[];
	options?: GenerateOptions;
}

export interface AbortRequest {
	type: 'abort';
	/** id of the in-flight generate request to interrupt. */
	id: number;
}

export type WorkerRequest = LoadRequest | GenerateRequest | AbortRequest;

// ---- worker → main ----------------------------------------------------------

export interface LoadProgressMessage {
	type: 'load-progress';
	id: number;
	progress: LoadProgress;
}

export interface ReadyMessage {
	type: 'ready';
	id: number;
	backend: Backend;
	modelId: string;
}

export interface ChunkMessage {
	type: 'chunk';
	id: number;
	text: string;
}

export interface DoneMessage {
	type: 'done';
	id: number;
	usage: Usage;
}

export interface ErrorMessage {
	type: 'error';
	id: number;
	message: string;
}

/**
 * Emitted when a generation failed on the current (backend, dtype) config and
 * the worker transparently reloaded the model on a safer one and retried
 * (SPEC §5 graceful degradation). `id` is the generate request that triggered it.
 */
export interface FallbackMessage {
	type: 'fallback';
	id: number;
	from: { backend: Backend; dtype: string };
	to: { backend: Backend; dtype: string };
	reason: string;
}

export type WorkerResponse =
	| LoadProgressMessage
	| ReadyMessage
	| ChunkMessage
	| DoneMessage
	| ErrorMessage
	| FallbackMessage;
