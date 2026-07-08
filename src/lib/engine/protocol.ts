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

export type WorkerResponse =
	| LoadProgressMessage
	| ReadyMessage
	| ChunkMessage
	| DoneMessage
	| ErrorMessage;
