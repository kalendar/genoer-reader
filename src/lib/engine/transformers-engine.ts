/**
 * Transformers.js implementation of the {@link Engine} interface (SPEC.md §5).
 *
 * This module owns the Web Worker (spawned via Vite's `?worker` import) and
 * multiplexes load/generate/abort requests over it, turning the worker's
 * message stream back into the promise + async-iterable surface the rest of
 * the app consumes. It does NOT import `@huggingface/transformers` itself —
 * only `worker.ts` does — so the "one library, swappable" boundary holds.
 *
 * CRASH RECOVERY LIVES HERE, not in the worker. Field-observed failure modes
 * (2026-07-08, Chrome/macOS):
 *  - fp16 WebGPU execution crashes at inference (OrtRun SafeInt overflow);
 *  - wasm traps ("memory access out of bounds") corrupt the worker's runtime —
 *    NOTHING in that worker can succeed afterwards, including a rescue reload;
 *  - a failed giant load leaves the wasm heap permanently grown/fragmented
 *    (wasm memory never shrinks), poisoning all later loads in that worker.
 * Therefore every recovery step tears the worker down and starts a FRESH one
 * (weights are browser-cached, so respawn+reload is cheap). The ladder:
 *  1. failed generation, nothing streamed → same config, fresh worker;
 *  2. still failing → next safer config (…→ q4 → wasm+q4), fresh worker each;
 *  3. exhausted → surface the error (with a model-tier suggestion if this
 *     repo simply has no safer variant to try).
 * Mid-stream failures are never retried — a retry would duplicate output.
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

/** One rung of the recovery ladder: what to ask the worker to load. */
interface LadderConfig {
	device: Backend | 'auto';
	dtype?: string;
}

function sameConfig(a: LadderConfig, b: LadderConfig): boolean {
	return a.device === b.device && a.dtype === b.dtype;
}

/**
 * Build the (device, dtype) ladder for a load request, constrained to weight
 * variants that actually exist in the repo (`availableDtypes` from the model
 * registry — repos differ, and a blind reload of a missing variant 404s).
 */
function buildLadder(opts?: LoadOptions): LadderConfig[] {
	const available = opts?.availableDtypes ?? [];
	const primary: LadderConfig = { device: opts?.device ?? 'auto', dtype: opts?.dtype };
	const ladder: LadderConfig[] = [primary];
	// Same backend, q4 (fp32 compute) — rescues fp16-path crashes.
	if (primary.dtype && primary.dtype !== 'q4' && available.includes('q4')) {
		ladder.push({ device: primary.device, dtype: 'q4' });
	}
	// Last resort: CPU/WASM with the safest available variant.
	if (primary.device !== 'wasm') {
		const wasmDtype = available.includes('q4') ? 'q4' : primary.dtype;
		const candidate: LadderConfig = { device: 'wasm', dtype: wasmDtype };
		if (!ladder.some((c) => sameConfig(c, candidate))) ladder.push(candidate);
	}
	return ladder;
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

	// Recovery-ladder state for the currently loaded model.
	private lastModelId: string | null = null;
	private ladder: LadderConfig[] = [];
	private ladderIndex = 0;
	private lastBackend: Backend | null = null;

	constructor() {
		this.worker = this.spawnWorker();
	}

	private spawnWorker(): Worker {
		const worker = new EngineWorker();
		worker.addEventListener('message', (e: MessageEvent<WorkerResponse>) =>
			this.onMessage(e.data)
		);
		worker.addEventListener('error', (e) => {
			const err = new Error(e.message || 'Worker error');
			this.loadWaiter?.reject(err);
			this.loadWaiter = null;
			for (const g of this.generations.values()) g.fail(err.message);
			this.generations.clear();
		});
		return worker;
	}

	/** Tear down the worker and start clean — see the header comment for why. */
	private respawnWorker(): void {
		try {
			this.worker.terminate();
		} catch {
			/* already dead is fine */
		}
		// Orphan any in-flight bookkeeping tied to the dead worker.
		this.loadWaiter = null;
		this.worker = this.spawnWorker();
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
		}
	}

	onFallback?: (info: {
		from: { backend: Backend; dtype: string };
		to: { backend: Backend; dtype: string };
		reason: string;
	}) => void;

	/** One raw load request against the CURRENT worker. */
	private doLoad(
		modelId: string,
		config: LadderConfig,
		onProgress?: (p: LoadProgress) => void
	): Promise<LoadResult> {
		const id = this.nextId++;
		return new Promise<LoadResult>((resolve, reject) => {
			this.loadWaiter = { id, resolve, reject, onProgress, agg: new ProgressAggregator() };
			this.send({ type: 'load', id, modelId, dtype: config.dtype, device: config.device });
		});
	}

	private noVariantSuggestion(): string {
		return this.ladder.length <= 1
			? ' This model has no safer weight variant to fall back to on this device — try the default 0.6B tier, which has the broadest fallback options.'
			: '';
	}

	async loadModel(
		modelId: string,
		opts?: LoadOptions,
		onProgress?: (p: LoadProgress) => void
	): Promise<LoadResult> {
		this.lastModelId = modelId;
		this.ladder = buildLadder(opts);
		let lastError: Error | null = null;
		for (let i = 0; i < this.ladder.length; i++) {
			const config = this.ladder[i];
			try {
				// Only the first rung shows download progress — later rungs read
				// from the browser cache and finish fast.
				const res = await this.doLoad(modelId, config, i === 0 ? onProgress : undefined);
				this.ladderIndex = i;
				this.lastBackend = res.backend;
				if (i > 0) {
					const prev = this.ladder[i - 1];
					this.onFallback?.({
						from: { backend: (prev.device === 'auto' ? 'webgpu' : prev.device) as Backend, dtype: prev.dtype ?? '?' },
						to: { backend: res.backend, dtype: config.dtype ?? '?' },
						reason: lastError?.message ?? 'load failed'
					});
				}
				return res;
			} catch (e) {
				lastError = e instanceof Error ? e : new Error(String(e));
				console.info(
					`[engine] load failed on ${config.device}/${config.dtype ?? 'default'}: ${lastError.message} — ` +
						(i + 1 < this.ladder.length ? 'respawning worker and trying the next variant' : 'ladder exhausted')
				);
				// The failed load poisoned the worker's heap — always start clean.
				this.respawnWorker();
			}
		}
		throw new Error((lastError?.message ?? 'Model load failed') + this.noVariantSuggestion());
	}

	chat(messages: ChatMessage[], opts?: GenerateOptions): ChatStream {
		// A tiny async queue bridging worker 'chunk' messages to `for await`.
		const queue: string[] = [];
		let notify: (() => void) | null = null;
		let done = false;
		let error: string | null = null;
		let hasChunks = false;
		let aborted = false;
		let currentGenId: number | null = null;
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

		/** Run one generation attempt against the current worker; resolve its outcome. */
		const attemptOnce = (): Promise<{ ok: boolean; message?: string }> =>
			new Promise((resolve) => {
				const id = this.nextId++;
				currentGenId = id;
				this.generations.set(id, {
					push: (text) => {
						hasChunks = true;
						queue.push(text);
						wake();
					},
					finish: (u) => {
						this.generations.delete(id);
						usageResolve(u);
						resolve({ ok: true });
					},
					fail: (message) => {
						this.generations.delete(id);
						resolve({ ok: false, message });
					}
				});
				this.send({ type: 'generate', id, messages, options: opts });
			});

		const runWithRecovery = async (): Promise<void> => {
			const modelId = this.lastModelId;
			// Attempt plan: current worker → same config in a fresh worker (cures
			// trap/heap-state crashes) → each remaining ladder rung, fresh worker.
			let sameConfigRetryUsed = false;
			let lastMessage = 'generation failed';
			for (;;) {
				const outcome = await attemptOnce();
				if (outcome.ok) {
					done = true;
					wake();
					return;
				}
				lastMessage = outcome.message ?? lastMessage;
				// Never retry after user abort or after partial output (duplication).
				if (aborted || hasChunks || !modelId) break;

				// Find the next rung that actually LOADS in a fresh worker; only then
				// re-attempt generation. A failed reload consumes that rung.
				let loaded = false;
				while (!loaded && !aborted) {
					let nextConfig: LadderConfig | null = null;
					let advanced = false;
					if (!sameConfigRetryUsed) {
						sameConfigRetryUsed = true;
						nextConfig = this.ladder[this.ladderIndex] ?? null;
					} else if (this.ladderIndex + 1 < this.ladder.length) {
						nextConfig = this.ladder[this.ladderIndex + 1];
						advanced = true;
					}
					if (!nextConfig) break;

					console.info(
						`[engine] generation failed (${lastMessage}) — ${advanced ? 'advancing ladder' : 'retrying same config'} in a fresh worker: ${nextConfig.device}/${nextConfig.dtype ?? 'default'}`
					);
					this.respawnWorker();
					try {
						const res = await this.doLoad(modelId, nextConfig);
						loaded = true;
						if (advanced) {
							const prev = this.ladder[this.ladderIndex];
							this.ladderIndex++;
							this.lastBackend = res.backend;
							this.onFallback?.({
								from: {
									backend: (prev.device === 'auto' ? 'webgpu' : prev.device) as Backend,
									dtype: prev.dtype ?? '?'
								},
								to: { backend: res.backend, dtype: nextConfig.dtype ?? '?' },
								reason: lastMessage
							});
						}
					} catch (reloadErr) {
						lastMessage = `${lastMessage}; recovery reload failed: ${reloadErr instanceof Error ? reloadErr.message : String(reloadErr)}`;
						this.respawnWorker();
						if (advanced) this.ladderIndex++; // that rung is dead — consume it
					}
				}
				if (!loaded) break;
			}
			error = lastMessage + (hasChunks ? '' : this.noVariantSuggestion());
			done = true;
			usageReject(new Error(error));
			wake();
		};

		void runWithRecovery();

		const abort = () => {
			aborted = true;
			if (currentGenId !== null && this.generations.has(currentGenId)) {
				this.send({ type: 'abort', id: currentGenId });
			}
		};

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
				abort();
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
			abort
		};
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
