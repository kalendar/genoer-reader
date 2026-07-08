/**
 * The single entry point every route's `load` function calls to figure out
 * "which book is open" (SPEC.md §8). Wraps `$lib/data/book` + `$lib/data/graph`
 * (bundled/URL sources, both fetched over the network) and `$lib/data/local-db`
 * (files loaded from disk, read from IndexedDB) behind one interface keyed off
 * the `?book=` query param — see `$lib/data/book-source` for how that param is
 * parsed into a {@link BookSourceRef}.
 *
 * Every existing route load function (`/read`, `/map`, `/chat`, `/pathways`,
 * `/notebook`, `/practice/[sectionId]`) previously hardcoded
 * `DEFAULT_BOOK_SLUG`; they now call `resolveActiveBook` instead, so a
 * `?book=` param routes the *whole app* through the loaded-your-own book, not
 * just the reader.
 */
import { loadBook, validateBook, DEFAULT_BOOK_SLUG, type Book } from './book';
import { loadGraph, validateGraph, crossCheckGraphAgainstBook, type GraphData } from './graph';
import { getLocalBook } from './local-db';
import { resolveBookParam, registerBookSource, type BookSourceRef } from './book-source';

export interface ResolvedBook {
	slug: string;
	book: Book;
	graph: GraphData | null;
	source: BookSourceRef;
	/** Non-fatal graph/book cross-check warnings (SPEC.md §8) — empty for the common case. */
	warnings: string[];
}

export class BookLoadError extends Error {}

async function resolveLocal(localId: string): Promise<ResolvedBook> {
	if (typeof indexedDB === 'undefined') {
		throw new BookLoadError(
			`"${localId}" was loaded from a local file — that only works in the browser tab it was loaded in (no IndexedDB access during prerendering/SSR).`
		);
	}
	const entry = await getLocalBook(localId);
	if (!entry) {
		throw new BookLoadError(
			`No locally loaded book found for "${localId}" in this browser. Local books are saved only in the browser/device they were loaded on — pick the file again from the landing page.`
		);
	}
	let bookData: unknown;
	try {
		bookData = JSON.parse(entry.bookJson);
	} catch {
		throw new BookLoadError(`The stored book.json for "${localId}" is corrupted — try loading the file again.`);
	}
	validateBook(bookData, localId);
	const book = bookData as Book;

	let graph: GraphData | null = null;
	if (entry.graphJson) {
		try {
			const graphData = JSON.parse(entry.graphJson);
			validateGraph(graphData, localId);
			graph = graphData;
		} catch (err) {
			console.warn(`Local book "${localId}": stored graph.json is invalid — map disabled.`, err);
		}
	}

	const warnings = graph
		? crossCheckGraphAgainstBook(graph, new Set(book.sections.map((s) => s.id)))
		: [];

	// The app-wide slug for a local load is the id the user chose in the loader form (`localId` —
	// also the IndexedDB/registry key), NOT `book.slug` from the file's own content. Unlike a URL
	// source (where the declared slug *is* the identity, so re-loading the same URL reuses the same
	// annotations), a local load's whole point is letting the same book.json be loaded under a
	// different slug to keep it isolated from another copy — e.g. loading the bundled book's own
	// book.json as a local file under "entrepreneurship-copy" must not collide with the bundled
	// book's "entrepreneurship" highlights/notes/chat/practice history.
	return {
		slug: localId,
		book,
		graph,
		source: { kind: 'local', slug: localId },
		warnings
	};
}

async function resolveUrl(fetchImpl: typeof fetch, dirUrl: string, hintSlug: string | null): Promise<ResolvedBook> {
	const cacheKeySlug = hintSlug ?? dirUrl;
	let book: Book;
	try {
		book = await loadBook(cacheKeySlug, fetchImpl, dirUrl);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new BookLoadError(`Couldn't load a book from ${dirUrl} — ${msg}`);
	}

	let graph: GraphData | null = null;
	try {
		graph = await loadGraph(book.slug, fetchImpl, dirUrl);
	} catch {
		graph = null; // loadGraph itself never throws, but stay defensive
	}

	const warnings = graph
		? crossCheckGraphAgainstBook(graph, new Set(book.sections.map((s) => s.id)))
		: [];

	// Remember this source for next time (SPEC.md §8: "store the book source per slug") — keyed by
	// the book's own declared slug, not the URL, so per-book localStorage/IndexedDB data (highlights,
	// chat, etc.) stays consistent across reloads of the same `?book=` URL.
	if (typeof window !== 'undefined') {
		registerBookSource(book.slug, 'url', { url: dirUrl, label: book.title });
	}

	return { slug: book.slug, book, graph, source: { kind: 'url', slug: book.slug, url: dirUrl }, warnings };
}

async function resolveBundled(fetchImpl: typeof fetch, slug: string): Promise<ResolvedBook> {
	if (slug !== DEFAULT_BOOK_SLUG) {
		throw new BookLoadError(
			`"${slug}" isn't a URL, and there's no previously loaded book by that name in this browser. ` +
				`To load a book, use "?book=" followed by the full https URL of a directory containing book.json.`
		);
	}
	const [book, graph] = await Promise.all([
		loadBook(slug, fetchImpl),
		loadGraph(slug, fetchImpl)
	]);
	return { slug, book, graph, source: { kind: 'bundled', slug }, warnings: [] };
}

/**
 * Resolve "the book this route should show" from a `?book=` param (or `null`
 * for the bundled default). Throws {@link BookLoadError} with a
 * human-readable message on any failure — callers should surface `.message`
 * directly rather than a generic "something went wrong".
 */
export async function resolveActiveBook(opts: {
	fetch: typeof fetch;
	bookParam: string | null;
}): Promise<ResolvedBook> {
	const ref = resolveBookParam(opts.bookParam, DEFAULT_BOOK_SLUG);
	if (ref.kind === 'local') return resolveLocal(ref.slug);
	if (ref.kind === 'url') return resolveUrl(opts.fetch, ref.url, ref.slug);
	return resolveBundled(opts.fetch, ref.slug);
}
