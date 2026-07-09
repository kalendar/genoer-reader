/**
 * Storage/offline utilities (SPEC.md §10) that live OUTSIDE the engine, per
 * the milestone brief ("wire it near the existing download flow, from
 * outside the engine") — nothing here touches `src/lib/engine/**`.
 *
 * Three responsibilities:
 *  - register the SvelteKit-built service worker (`src/service-worker.ts`);
 *  - ask the browser to persist storage once a model download completes, so
 *    a multi-GB cached model isn't evicted under storage pressure;
 *  - introspect/clear Transformers.js's own model cache (the Cache Storage
 *    entry named `transformers-cache` — verified against
 *    `@huggingface/transformers`'s bundled source, 2026-07-08) for the Model
 *    Settings panel's usage display and "Remove downloaded models" button.
 */

import { dev } from '$app/environment';

/** Register the service worker built from `src/service-worker.ts` — PRODUCTION ONLY.
 *
 * Contrary to this function's original assumption, SvelteKit's dev server DOES serve
 * `/service-worker.js` (it responded 200 in dev), so unconditional registration installed a live
 * SW over the dev server. That breaks dev retroactively: the SW precaches a shell snapshot and
 * keeps intercepting fetches while Vite's module URLs churn across restarts — field-reported as
 * "chat stopped working" the session after the SW shipped, with the app code unchanged.
 *
 * In dev this now actively UNREGISTERS any existing registration and clears the app-shell/media
 * caches, so a browser poisoned by an earlier dev visit heals itself on the next load. (The
 * Transformers.js model cache is deliberately left alone — multi-GB, SW-independent, still valid.)
 * Safe to call from every page; call once, e.g. from the root layout's `onMount`. */
export async function registerServiceWorker(): Promise<void> {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
	if (dev) {
		try {
			const regs = await navigator.serviceWorker.getRegistrations();
			for (const reg of regs) await reg.unregister();
			if (typeof caches !== 'undefined') {
				for (const key of await caches.keys()) {
					if (key.startsWith('genoer-')) await caches.delete(key);
				}
			}
			if (regs.length > 0) {
				console.info('[storage] dev mode: unregistered stale service worker(s) — reload once more for a clean page');
			}
		} catch {
			/* best-effort cleanup */
		}
		return;
	}
	try {
		await navigator.serviceWorker.register('/service-worker.js', { type: 'module' });
	} catch (err) {
		// Unsupported browser — non-fatal, the app works fully online.
		console.info('[storage] service worker registration skipped:', err instanceof Error ? err.message : err);
	}
}

/**
 * Ask the browser not to auto-evict this origin's storage under pressure (SPEC.md §10 "cached
 * permanently"). Best-effort and silent either way — the persistence *request* API
 * (`navigator.storage.persist()`) doesn't guarantee a grant, and either outcome is fine; the model
 * still works, just without the stronger eviction guarantee. Called once a model download
 * completes (see `$lib/stores/engine-state.svelte.ts`), since that's the point multi-GB of cached
 * weights actually exist to protect.
 */
export async function requestPersistentStorage(): Promise<boolean> {
	if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
	try {
		return await navigator.storage.persist();
	} catch {
		return false;
	}
}

export interface StorageUsage {
	/** Bytes used / quota, from `navigator.storage.estimate()` — undefined if unsupported. */
	usage?: number;
	quota?: number;
	/** Whether persistent storage has been granted (see `requestPersistentStorage`). */
	persisted: boolean;
}

export async function getStorageUsage(): Promise<StorageUsage> {
	const persisted =
		typeof navigator !== 'undefined' && navigator.storage?.persisted
			? await navigator.storage.persisted().catch(() => false)
			: false;
	if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
		return { persisted };
	}
	try {
		const { usage, quota } = await navigator.storage.estimate();
		return { usage, quota, persisted };
	} catch {
		return { persisted };
	}
}

/** The Cache Storage entry Transformers.js writes downloaded ONNX weights/tokenizer files into —
 * verified against the bundled `@huggingface/transformers` source (searched for `caches.open(`). */
const TRANSFORMERS_CACHE_NAME = 'transformers-cache';

export interface CachedModelInfo {
	/** Best-effort `org/repo` parsed from the cached request URLs' path, e.g. "onnx-community/Qwen3-0.6B-ONNX". */
	repo: string;
	fileCount: number;
	/** Sum of `Content-Length` across cached responses for this repo, where available. */
	approxBytes: number;
}

function repoFromUrl(url: string): string | null {
	try {
		const { pathname } = new URL(url);
		const parts = pathname.split('/').filter(Boolean);
		// Hugging Face resolve URLs look like /<org>/<repo>/resolve/<rev>/<path...>.
		return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
	} catch {
		return null;
	}
}

/** List the model repos currently cached by Transformers.js, with file counts and approximate
 * sizes — for Model Settings' Cache Storage usage display (SPEC.md §10). */
export async function listCachedModelRepos(): Promise<CachedModelInfo[]> {
	if (typeof caches === 'undefined') return [];
	let cache: Cache;
	try {
		cache = await caches.open(TRANSFORMERS_CACHE_NAME);
	} catch {
		return [];
	}
	const requests = await cache.keys();
	const byRepo = new Map<string, CachedModelInfo>();
	for (const req of requests) {
		const repo = repoFromUrl(req.url) ?? 'unknown';
		let entry = byRepo.get(repo);
		if (!entry) {
			entry = { repo, fileCount: 0, approxBytes: 0 };
			byRepo.set(repo, entry);
		}
		entry.fileCount++;
		try {
			const res = await cache.match(req);
			const len = res?.headers.get('content-length');
			if (len) entry.approxBytes += Number(len) || 0;
		} catch {
			/* best-effort size accounting */
		}
	}
	return [...byRepo.values()].sort((a, b) => b.approxBytes - a.approxBytes);
}

/** Clear every entry in the Transformers.js model cache ("Remove downloaded models", SPEC.md §10).
 * Does not touch the SW's own app-shell/media caches. The caller is responsible for also disposing
 * the live engine if a model is currently loaded (a cleared cache doesn't unload an in-memory
 * model) — see the Model Settings panel. */
export async function clearModelCache(): Promise<void> {
	if (typeof caches === 'undefined') return;
	await caches.delete(TRANSFORMERS_CACHE_NAME);
}

/**
 * True when the repo's actual ONNX WEIGHTS (not just its few-KB config/tokenizer
 * files, which an aborted download also leaves behind) are in the model cache.
 * Checks for the entry's existence by URL rather than summing Content-Length —
 * large CDN responses don't reliably carry that header, and `cache.put` only
 * stores fully-downloaded bodies, so presence of a `.onnx`/`.onnx_data` entry
 * means a complete weights file. Used to decide whether a model can be
 * auto-loaded without triggering a surprise download.
 */
export async function hasCachedWeights(repo: string): Promise<boolean> {
	if (typeof caches === 'undefined') return false;
	try {
		const cache = await caches.open(TRANSFORMERS_CACHE_NAME);
		const requests = await cache.keys();
		return requests.some((req) => {
			try {
				const { pathname } = new URL(req.url);
				return (
					pathname.includes(`/${repo}/`) &&
					(pathname.endsWith('.onnx') || pathname.includes('.onnx_data'))
				);
			} catch {
				return false;
			}
		});
	} catch {
		return false;
	}
}
