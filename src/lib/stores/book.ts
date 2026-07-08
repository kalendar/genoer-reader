/**
 * The "current book" store — the shared source of truth later milestones
 * (chat retrieval, concept map, study features) read from. Route `load`
 * functions do the actual fetching (via `$lib/data/book`'s `loadBook`, which
 * is prerender/SSR-safe); the reader layout populates this store from that
 * load data so any component in the tree can reach the current book
 * reactively without prop-drilling.
 *
 * Usage from a later feature:
 *   import { currentBook, currentBookSlug } from '$lib/stores/book';
 *   $currentBook?.sections...
 *
 * Do not fetch book.json from this module directly — go through
 * `$lib/data/book`'s `loadBook` (or the `load` function of the route you're
 * adding) so prerendering keeps working.
 */
import { writable } from 'svelte/store';
import { DEFAULT_BOOK_SLUG, type Book } from '$lib/data/book';

/** Slug of the book currently open in the reader. */
export const currentBookSlug = writable<string>(DEFAULT_BOOK_SLUG);

/** The currently open book's parsed data, or null before the first load resolves. */
export const currentBook = writable<Book | null>(null);

/** Called by the reader layout once its `load` function resolves a book. */
export function setCurrentBook(slug: string, book: Book): void {
	currentBookSlug.set(slug);
	currentBook.set(book);
}
