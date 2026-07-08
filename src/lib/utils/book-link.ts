/**
 * Carries the active `?book=` param (SPEC.md §8) across in-app links.
 *
 * Every route resolves "which book" independently from its own URL's
 * `?book=` param (see `$lib/data/resolve-book`) — a plain relative link like
 * `/read/{id}` or `/map` therefore silently drops back to the bundled
 * default the instant a non-bundled book is open, because the destination
 * URL simply has no `book` param on it. This is what makes "route the whole
 * app through it" (SPEC.md §8) actually true: the top nav, section
 * cross-links (prev/next, TOC, citations, concept "defined in", map node
 * links, pathway steps, notebook deep links, practice "show me where") all
 * need to append this suffix, not just the loader UI's own initial link.
 *
 * Reads `$app/state`'s `page` directly (rather than a prop) so every
 * component can use it without threading `slug`/`book` through props it
 * doesn't otherwise need — `page.url` is reactive, so links stay correct
 * across navigation without extra plumbing.
 */
import { page } from '$app/state';

/**
 * The active `?book=` value, or `null`. SvelteKit throws on any read of
 * `url.search`/`url.searchParams` (which `page.url` shares the same
 * restricted `URL` instance with) during the actual prerender pass — every
 * route in this app is prerendered for the bundled default book (SPEC.md
 * §2) — so this swallows that specific throw the same way
 * `$lib/data/book-source`'s `readBookParam` does for `load` functions.
 * Real values are read the same way at runtime (after hydration, in the
 * browser) where that restriction doesn't apply.
 */
function activeBookParam(): string | null {
	try {
		return page.url.searchParams.get('book');
	} catch {
		return null;
	}
}

/** `"?book=..."` if a non-bundled book is active on the current page, else `""`. Append directly
 * after a bare path, e.g. `` `/read/${id}${bookQuerySuffix()}` ``. */
export function bookQuerySuffix(): string {
	const book = activeBookParam();
	return book ? `?book=${encodeURIComponent(book)}` : '';
}

/** `"&book=..."` if a non-bundled book is active, else `""` — for hrefs that already have a `?...`
 * query string of their own (e.g. `/map?concept=...&view=...`), so the two never collide into an
 * invalid double `?`. */
export function bookAmpParam(): string {
	const book = activeBookParam();
	return book ? `&book=${encodeURIComponent(book)}` : '';
}

/** Inserts the active `?book=` param into an already-built href, correctly positioned before any
 * `#fragment` (e.g. a citation/deep-link href like `/read/{id}#{anchor}` from `$lib/chat/citations`,
 * which is built without book-param awareness so it stays a pure, easily-testable function). */
export function withBookParam(href: string): string {
	const book = activeBookParam();
	if (!book) return href;
	const hashIndex = href.indexOf('#');
	const path = hashIndex === -1 ? href : href.slice(0, hashIndex);
	const hash = hashIndex === -1 ? '' : href.slice(hashIndex);
	const sep = path.includes('?') ? '&' : '?';
	return `${path}${sep}book=${encodeURIComponent(book)}${hash}`;
}
