/**
 * Transformers.js implementation of the {@link Engine} interface (SPEC.md §5).
 *
 * This module owns the Web Worker (spawned via Vite's `?worker` import) and
 * multiplexes load/generate/abort requests over it, turning the worker's
 * message stream back into the promise + async-iterable surface the rest of
 * the app consumes. It does NOT import `@huggingface/transformers` itself —
 * only `worker.ts` does — so the "one library, swappable" boundary holds.
 */
import EngineWorker from './worker?worker';
import type {
	Backend,
	ChatMessage,
	ChatStream,
	Engine,
	EngineConfig,
	GenerateOptions,
	LoadOptions,
	LoadProgress,
	LoadResult,
	Usage
} from './types';
import type { WorkerRequest, WorkerResponse } from './protocol';

/** Accumulate per-file byte progress into a single overall fraction 0–1. */
class ProgressAggregator {
	private files = new Map<string, { loaded: number; total: number }>();

	update(p: LoadProgress): number {
		if (p.file && typeof p.total === 'number' && p.total > 0) {
			this.files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
		}
		let loaded = 0;
		let total = 0;
		for (const f of this.files.values()) {
			loaded += f.loaded;
			total += f.total;
		}
		return total > 0 ? loaded / total : 0;
	}
}

class TransformersEngine implements Engine {
	private worker: Worker;
	private nextId = 1;
	/** id → chunk sink + terminal resolvers for an in-flight generation. */
	private generations = new Map<
		number,
		{
			push: (text: string) => void;
			finish: (usage: Usage) => void;
			fail: (message: string) => void;
		}
	>();
	private loadWaiter: {
		id: number;
		resolve: (r: LoadResult) => void;
		reject: (e: Error) => void;
		onProgress?: (p: LoadProgress) => void;
		agg: ProgressAggregator;
	} | null = null;

	constructor() {
		this.worker = new EngineWorker();
		this.worker.addEventListener('message', (e: MessageEvent<WorkerResponse>) =>
			this.onMessage(e.data)
		);
		this.worker.addEventListener('error', (e) => {
			const err = new Error(e.message || 'Worker error');
			this.loadWaiter?.reject(err);
			this.loadWaiter = null;
			for (const g of this.generations.values()) g.fail(err.message);
			this.generations.clear();
		});
	}

	private send(msg: WorkerRequest): void {
		this.worker.postMessage(msg);
	}

	private onMessage(msg: WorkerResponse): void {
		switch (msg.type) {
			case 'load-progress': {
				const w = this.loadWaiter;
				if (w && w.id === msg.id) {
					const overall = w.agg.update(msg.progress);
					w.onProgress?.({ ...msg.progress, overall });
				}
				break;
			}
			case 'ready': {
				const w = this.loadWaiter;
				if (w && w.id === msg.id) {
					w.onProgress?.({ status: 'ready', overall: 1 });
					w.resolve({ backend: msg.backend, modelId: msg.modelId });
					this.loadWaiter = null;
				}
				break;
			}
			case 'chunk': {
				this.generations.get(msg.id)?.push(msg.text);
				break;
			}
			case 'done': {
				this.generations.get(msg.id)?.finish(msg.usage);
				break;
			}
			case 'error': {
				if (this.loadWaiter && this.loadWaiter.id === msg.id) {
					this.loadWaiter.reject(new Error(msg.message));
					this.loadWaiter = null;
				}
				this.generations.get(msg.id)?.fail(msg.message);
				break;
			}
			case 'fallback': {
				console.info(
					`[engine] inference failed on ${msg.from.backend}/${msg.from.dtype}; ` +
						`retrying on ${msg.to.backend}/${msg.to.dtype} (${msg.reason})`
				);
				this.onFallback?.({ from: msg.from, to: msg.to, reason: msg.reason });
				break;
			}
		}
	}

	onFallback?: (info: {
		from: { backend: Backend; dtype: string };
		to: { backend: Backend; dtype: string };
		reason: string;
	}) => void;

	loadModel(
		modelId: string,
		opts?: LoadOptions,
		onProgress?: (p: LoadProgress) => void
	): Promise<LoadResult> {
		const id = this.nextId++;
		return new Promise<LoadResult>((resolve, reject) => {
			this.loadWaiter = { id, resolve, reject, onProgress, agg: new ProgressAggregator() };
			this.send({
				type: 'load',
				id,
				modelId,
				dtype: opts?.dtype,
				device: opts?.device,
				availableDtypes: opts?.availableDtypes
			});
		});
	}

	chat(messages: ChatMessage[], opts?: GenerateOptions): ChatStream {
		const id = this.nextId++;

		// A tiny async queue bridging worker 'chunk' messages to `for await`.
		const queue: string[] = [];
		let notify: (() => void) | null = null;
		let done = false;
		let error: string | null = null;
		let usageResolve!: (u: Usage) => void;
		let usageReject!: (e: Error) => void;
		const usage = new Promise<Usage>((res, rej) => {
			usageResolve = res;
			usageReject = rej;
		});
		// Avoid unhandled-rejection if the consumer never awaits `.usage`.
		usage.catch(() => {});

		const wake = () => {
			notify?.();
			notify = null;
		};

		this.generations.set(id, {
			push: (text) => {
				queue.push(text);
				wake();
			},
			finish: (u) => {
				done = true;
				usageResolve(u);
				this.generations.delete(id);
				wake();
			},
			fail: (message) => {
				error = message;
				done = true;
				usageReject(new Error(message));
				this.generations.delete(id);
				wake();
			}
		});

		this.send({ type: 'generate', id, messages, options: opts });

		const self = this;
		const iterator: AsyncIterableIterator<string> = {
			async next(): Promise<IteratorResult<string>> {
				// eslint-disable-next-line no-constant-condition
				while (true) {
					if (queue.length > 0) return { value: queue.shift() as string, done: false };
					if (error) throw new Error(error);
					if (done) return { value: undefined, done: true };
					await new Promise<void>((r) => (notify = r));
				}
			},
			async return(): Promise<IteratorResult<string>> {
				self.abortGeneration(id);
				done = true;
				return { value: undefined, done: true };
			},
			[Symbol.asyncIterator]() {
				return this;
			}
		};

		return {
			[Symbol.asyncIterator]: () => iterator,
			usage,
			abort: () => this.abortGeneration(id)
		};
	}

	private abortGeneration(id: number): void {
		if (this.generations.has(id)) {
			this.send({ type: 'abort', id });
		}
	}

	countTokens(text: string): number {
		// Approximate (SPEC §5 says "approx") and matches the converter's own
		// ~chars/4 token estimate used across book.json — good enough for budgeting.
		return Math.ceil(text.length / 4);
	}

	dispose(): void {
		this.worker.terminate();
		this.generations.clear();
		this.loadWaiter = null;
	}
}

/**
 * Create an engine. Today this always returns the Transformers.js engine; the
 * `config.kind` hook is where a future second engine would branch (SPEC §5).
 */
export function createEngine(_config?: EngineConfig): Engine {
	return new TransformersEngine();
}

export type { Backend };
