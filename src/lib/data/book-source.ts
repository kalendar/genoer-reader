/**
 * Book source resolution (SPEC.md §8 "Load your own").
 *
 * Three kinds of book a `?book=` URL param (or a bare slug for the bundled
 * default) can point at:
 *  - `bundled` — ships with the app at `/books/<slug>/`.
 *  - `url` — a directory on any static host containing `book.json` (+
 *    optional `graph.json`, `media/`), given as an absolute https URL.
 *  - `local` — loaded from a dropped/picked file, persisted in IndexedDB
 *    (`$lib/data/local-db`).
 *
 * A small localStorage registry remembers `slug -> source URL` for `url`
 * sources (SPEC.md §8: "store the book source per slug") so a bare slug in
 * the `?book=` param resolves without the user re-pasting the URL, and so a
 * "recently loaded books" list can be shown on the landing page.
 */

const REGISTRY_KEY = 'genoer:book-sources';

export type BookSourceRef =
	| { kind: 'bundled'; slug: string }
	| { kind: 'url'; slug: string | null; url: string }
	| { kind: 'local'; slug: string };

interface RegistryEntry {
	slug: string;
	kind: 'url' | 'local';
	/** Directory URL for `url` sources; omitted for `local`. */
	url?: string;
	label: string;
	addedAt: number;
}

function storageAvailable(): boolean {
	return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readRegistry(): RegistryEntry[] {
	if (!storageAvailable()) return [];
	try {
		const raw = window.localStorage.getItem(REGISTRY_KEY);
		return raw ? (JSON.parse(raw) as RegistryEntry[]) : [];
	} catch {
		return [];
	}
}

function writeRegistry(entries: RegistryEntry[]): void {
	if (!storageAvailable()) return;
	try {
		window.localStorage.setItem(REGISTRY_KEY, JSON.stringify(entries));
	} catch {
		/* quota / private mode — non-fatal, the load itself still works this session */
	}
}

/** Normalize a directory URL: strip a trailing `/book.json` if present, ensure a trailing slash. */
export function normalizeBookDirUrl(input: string): string {
	let url = input.trim();
	url = url.replace(/\/book\.json$/i, '');
	if (!url.endsWith('/')) url += '/';
	return url;
}

/** Register (or update) a book source in the localStorage registry, keyed by its declared slug. */
export function registerBookSource(
	slug: string,
	kind: 'url' | 'local',
	opts: { url?: string; label: string }
): void {
	const entries = readRegistry().filter((e) => e.slug !== slug);
	entries.unshift({ slug, kind, url: opts.url, label: opts.label, addedAt: Date.now() });
	writeRegistry(entries.slice(0, 50)); // cap so the registry can't grow unbounded
}

export function unregisterBookSource(slug: string): void {
	writeRegistry(readRegistry().filter((e) => e.slug !== slug));
}

export function listRegisteredSources(): RegistryEntry[] {
	return readRegistry();
}

export function getRegisteredSource(slug: string): RegistryEntry | null {
	return readRegistry().find((e) => e.slug === slug) ?? null;
}

/** Reverse lookup: has this exact directory URL already been registered under some slug? Lets
 * synchronous/no-fetch consumers (e.g. the notebook page) resolve `?book=<url>` to a slug without
 * re-fetching book.json just to read its declared `slug` field. */
export function getRegisteredSourceByUrl(url: string): RegistryEntry | null {
	return readRegistry().find((e) => e.kind === 'url' && e.url === url) ?? null;
}

/**
 * Resolve a `?book=` param (or `null`/empty for "no override") to a
 * {@link BookSourceRef}. Does not fetch or validate anything — purely
 * string/registry logic, safe to call during SSR/prerendering.
 */
export function resolveBookParam(param: string | null | undefined, defaultSlug: string): BookSourceRef {
	if (!param || param === defaultSlug) return { kind: 'bundled', slug: defaultSlug };
	if (param.startsWith('local:')) return { kind: 'local', slug: param.slice('local:'.length) };
	if (/^https?:\/\//i.test(param)) return { kind: 'url', slug: null, url: normalizeBookDirUrl(param) };
	// A bare slug: look it up in the registry (previously loaded url/local book).
	const registered = getRegisteredSource(param);
	if (registered?.kind === 'url' && registered.url) {
		return { kind: 'url', slug: registered.slug, url: registered.url };
	}
	if (registered?.kind === 'local') {
		return { kind: 'local', slug: registered.slug };
	}
	// Unknown bare slug — treat as bundled and let the loader 404 with a clear message rather than
	// guessing; most likely a stale/typo'd link.
	return { kind: 'bundled', slug: param };
}

/** The `?book=` query value that round-trips back to this source (for links/history). */
export function bookParamFor(ref: BookSourceRef, defaultSlug: string): string | null {
	if (ref.kind === 'bundled') return ref.slug === defaultSlug ? null : ref.slug;
	if (ref.kind === 'local') return `local:${ref.slug}`;
	return ref.slug ?? ref.url;
}

/**
 * Read the `?book=` param from a `load` event's `url`, safe to call during prerendering. SvelteKit
 * throws on any access to `url.search`/`url.searchParams` while a page is actually being prerendered
 * (it would otherwise make one static output depend on a query string that isn't part of the
 * prerendered path) — every route here is prerendered for the bundled default book (SPEC.md §2), so
 * this swallows that specific throw and falls back to "no override," which is exactly the bundled
 * book the static build should render. Real `?book=` values are read the same way at runtime — after
 * hydration, in the browser, where that restriction doesn't apply and this never throws.
 */
export function readBookParam(url: URL): string | null {
	try {
		return url.searchParams.get('book');
	} catch {
		return null;
	}
}

/** URL-safe slug suggestion from a book title, for the local-load form's editable slug field. */
export function slugify(title: string): string {
	const base = title
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return base || `book-${Date.now().toString(36)}`;
}
