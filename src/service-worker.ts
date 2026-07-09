/// <reference types="@sveltejs/kit" />
/**
 * PWA offline support (SPEC.md §10: "installable PWA; after first visit (and
 * model download), the bundled book, graph, and chat work with no
 * connection").
 *
 * Precached at install time: the built app shell (JS/CSS/HTML — `build` and
 * `prerendered` from the `$service-worker` module) plus every *non-media*
 * static asset — which, for the bundled book, is exactly `book.json` and
 * `graph.json`. Media is deliberately excluded from the precache (it's
 * 100+ MB locally and the spec is explicit: "NOT media — too big"); instead
 * it's cached lazily, one file at a time, the first time it's actually
 * fetched (a stale-while-revalidate-ish cache-first policy), so a section a
 * reader has actually viewed stays available offline without ever paying for
 * the whole book's image set up front.
 *
 * Scope: same-origin requests only. A book loaded from `?book=<url>` on a
 * different origin (SPEC.md §8 "load your own") isn't specially cached here —
 * it rides on the browser's normal HTTP cache, not this service worker.
 *
 * The inference model itself is NOT cached here — Transformers.js manages its
 * own Cache Storage entry (`transformers-cache`, SPEC.md §10 "model weights
 * ... cached permanently"); see `$lib/utils/storage.ts` for how the app
 * inspects/clears that cache from the Model Settings panel.
 */
// `$service-worker`'s own `base` (not `$app/paths`'s) — service workers can't use `$app/paths`, and
// this one is derived from `location.pathname` at runtime, which SvelteKit's docs note "will
// continue to work correctly if the site is deployed to a subdirectory."
import { base, build, files, prerendered, version } from '$service-worker';

const CACHE_NAME = `genoer-shell-${version}`;
const MEDIA_CACHE_NAME = 'genoer-media';

// Every static asset except media — see header comment. `files` is every file under `static/` at
// build time; on a machine with the (gitignored, locally-only) book media present on disk that
// would otherwise include the entire multi-hundred-file, 100+MB media/ folder.
const PRECACHE_STATIC = files.filter((f) => !f.includes('/media/'));
const PRECACHE_URLS = [...build, ...prerendered, ...PRECACHE_STATIC];

const sw = self as unknown as ServiceWorkerGlobalScope;

sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE_NAME);
			// Best-effort: one missing/failed asset (e.g. a prerendered route that 404s in this
			// environment) shouldn't abort the whole install and leave the shell uncached.
			await Promise.all(
				PRECACHE_URLS.map(async (url) => {
					try {
						await cache.add(url);
					} catch (err) {
						console.warn('[service-worker] failed to precache', url, err);
					}
				})
			);
			await sw.skipWaiting();
		})()
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(
				keys
					.filter((k) => k !== CACHE_NAME && k !== MEDIA_CACHE_NAME && k.startsWith('genoer-'))
					.map((k) => caches.delete(k))
			);
			await sw.clients.claim();
		})()
	);
});

function isMediaRequest(url: URL): boolean {
	return url.origin === self.location.origin && /\/books\/[^/]+\/media\//.test(url.pathname);
}

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return; // cross-origin (e.g. HF model CDN, a loaded-your-own book) — not this worker's job

	// Media: cache-as-fetched, cache-first thereafter (SPEC.md §10 "cache media lazily as fetched").
	if (isMediaRequest(url)) {
		event.respondWith(
			(async () => {
				const cache = await caches.open(MEDIA_CACHE_NAME);
				const cached = await cache.match(request);
				if (cached) return cached;
				try {
					const response = await fetch(request);
					if (response.ok) cache.put(request, response.clone());
					return response;
				} catch (err) {
					if (cached) return cached;
					throw err;
				}
			})()
		);
		return;
	}

	// App shell + book.json/graph.json: precached, cache-first with a network fallback (so a fresh
	// deploy's un-precached edge cases and any book files added after this SW installed still work).
	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE_NAME);
			const cached = await cache.match(request, { ignoreSearch: true });
			if (cached) return cached;
			try {
				const response = await fetch(request);
				if (response.ok && request.url.startsWith(self.location.origin)) {
					cache.put(request, response.clone());
				}
				return response;
			} catch (err) {
				// Offline and not precached — for a navigation request, fall back to the shell's root
				// page rather than a hard failure, since this is a client-routed SPA once hydrated.
				// `base` is a subpath (e.g. "/genoer-reader") under a GitHub Pages project deploy — the
				// root page actually lives at "<base>/", not "/".
				if (request.mode === 'navigate') {
					const shell = await cache.match(`${base}/`);
					if (shell) return shell;
				}
				throw err;
			}
		})()
	);
});
