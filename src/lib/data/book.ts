/**
 * Data layer for GenOER Reader.
 *
 * This is the single choke point that knows how a `book.json` (produced by
 * the openstax-convert pipeline — see SPEC.md §8) gets from the network into
 * the app. Every other module (routes, stores, components) goes through
 * `loadBook()` rather than fetching JSON directly.
 *
 * Later milestones (the loader, §8) are expected to extend `loadBook` to
 * accept an arbitrary URL or an in-browser File/zip instead of only a
 * bundled-book slug — keep that in mind before hard-coding slug assumptions
 * elsewhere in the app. Reach for `currentBookSlug` / `currentBook` in
 * `$lib/stores/book.ts` for reactive access to "the book currently open in
 * the reader"; use this module directly only from `load` functions.
 */

/** A figure/image referenced by a section (metadata only; images render inline via block html). */
export interface Figure {
	src: string;
	alt: string;
	caption?: string;
}

/** A single content block within a section. `anchor` is globally unique across the whole book. */
export interface Block {
	/** Globally unique id, e.g. "m71114-b4". Becomes the block's DOM id when rendered. */
	anchor: string;
	/** Heading breadcrumb trail for orientation within long sections. */
	trail: string[];
	heading: string | null;
	/** Pre-cleaned semantic HTML. Figure `img[src]` is relative ("media/<file>") and must be
	 * resolved against the book's media base path before rendering — see `$lib/utils/media`. */
	html: string;
	/** Plain text rendering of the block; not used for display, only for search/grounding. */
	text: string;
	tokens: number;
}

/** One entry of a section's table of contents / reading spine. */
export interface Section {
	id: string;
	kind: string; // "section" | "introduction" | "preface" | "appendix" | ...
	chapter: number | null;
	/** Dotted section number, e.g. "5.1". Null for un-numbered sections (intros, prefaces, appendices). */
	number: string | null;
	title: string;
	objectives: string[];
	figures: Figure[];
	tokens: number;
	blocks: Block[];
	doc_class?: string;
	/**
	 * Footnotes extracted from the section's blocks by the converter (each
	 * in-text occurrence is a numbered superscript linking to `#<id>` here).
	 * Optional: books converted before footnote extraction simply lack it.
	 */
	footnotes?: { id: string; html: string }[];
}

/** A flat table-of-contents entry: either a chapter heading or a link to a section. */
export interface TocEntry {
	id?: string;
	number?: string | null;
	title: string;
	chapter: number | null;
	/** True for chapter-heading rows (no `id`, not directly navigable). */
	heading?: boolean;
}

export interface Book {
	title: string;
	publisher: string;
	license: string;
	license_url: string;
	slug: string;
	toc: TocEntry[];
	sections: Section[];
}

/** Slug of the bundled reference book (SPEC.md §8) and the store's default. */
export const DEFAULT_BOOK_SLUG = 'entrepreneurship';

/** Where a book's `book.json` lives, given its slug. Pass `baseUrl` (a directory URL, trailing
 * slash) for a "load your own" book hosted elsewhere (SPEC.md §8); omit it for the bundled book. */
export function bookUrl(slug: string, baseUrl?: string): string {
	return baseUrl ? `${baseUrl}book.json` : `/books/${slug}/book.json`;
}

/** Base path to resolve a section block's relative `media/<file>` image src against. */
export function mediaBase(slug: string, baseUrl?: string): string {
	return baseUrl ? `${baseUrl}media/` : `/books/${slug}/media/`;
}

export class BookValidationError extends Error {}

/** Minimal structural validation (SPEC.md §8) — fail loudly with a specific, human-readable error
 * rather than letting the reader render a half-broken page. Exported so the "load your own" UI can
 * run the same checks client-side before committing a local file to storage. */
export function validateBook(data: unknown, slug: string): asserts data is Book {
	if (!data || typeof data !== 'object') {
		throw new BookValidationError(`Book "${slug}": book.json is not an object`);
	}
	const book = data as Partial<Book>;
	for (const field of ['title', 'publisher', 'license', 'slug'] as const) {
		if (typeof book[field] !== 'string') {
			throw new BookValidationError(`Book "${slug}": missing or invalid "${field}"`);
		}
	}
	if (!Array.isArray(book.toc)) {
		throw new BookValidationError(`Book "${slug}": "toc" is not an array`);
	}
	if (!Array.isArray(book.sections) || book.sections.length === 0) {
		throw new BookValidationError(`Book "${slug}": "sections" is missing or empty`);
	}
	book.sections.forEach((section, i) => {
		if (!section || typeof section.id !== 'string') {
			throw new BookValidationError(`Book "${slug}": sections[${i}] has no id`);
		}
		if (!Array.isArray(section.blocks)) {
			throw new BookValidationError(`Book "${slug}": sections[${i}] ("${section.id}") has no blocks array`);
		}
		section.blocks.forEach((block, j) => {
			if (!block || typeof block.anchor !== 'string') {
				throw new BookValidationError(
					`Book "${slug}": sections[${i}] ("${section.id}") blocks[${j}] has no anchor`
				);
			}
		});
	});
}

/** In-memory cache of in-flight/completed book loads, keyed by slug. Fetching the same book twice
 * (e.g. once from a layout `load` and once from a page `load`) is free after the first call. */
const bookCache = new Map<string, Promise<Book>>();

/**
 * Load and validate a book by slug. Pass the `fetch` from a SvelteKit `load` event when calling
 * this from a `load` function — it works uniformly during prerendering and in the browser. Pass
 * `baseUrl` for a "load your own" book hosted elsewhere (SPEC.md §8); the cache key includes it so
 * two different sources never collide even if they happen to declare the same slug.
 */
export function loadBook(slug: string, fetchImpl: typeof fetch = fetch, baseUrl?: string): Promise<Book> {
	const cacheKey = baseUrl ? `${baseUrl}::${slug}` : slug;
	let cached = bookCache.get(cacheKey);
	if (!cached) {
		cached = (async () => {
			const res = await fetchImpl(bookUrl(slug, baseUrl));
			if (!res.ok) {
				throw new Error(`Failed to load book "${slug}": HTTP ${res.status} fetching ${bookUrl(slug, baseUrl)}`);
			}
			const data = await res.json();
			validateBook(data, slug);
			return data;
		})();
		cached.catch(() => bookCache.delete(cacheKey)); // don't cache failures
		bookCache.set(cacheKey, cached);
	}
	return cached;
}

export function findSectionIndex(book: Book, sectionId: string): number {
	return book.sections.findIndex((s) => s.id === sectionId);
}

export function findSection(book: Book, sectionId: string): Section | undefined {
	return book.sections.find((s) => s.id === sectionId);
}

export function prevSection(book: Book, sectionId: string): Section | null {
	const i = findSectionIndex(book, sectionId);
	return i > 0 ? book.sections[i - 1] : null;
}

export function nextSection(book: Book, sectionId: string): Section | null {
	const i = findSectionIndex(book, sectionId);
	return i >= 0 && i < book.sections.length - 1 ? book.sections[i + 1] : null;
}

/** The section the reader lands on when there's no saved reading position. */
export function firstSection(book: Book): Section | undefined {
	return book.sections[0];
}
