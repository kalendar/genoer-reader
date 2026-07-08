import { loadBook, DEFAULT_BOOK_SLUG } from '$lib/data/book';
import type { LayoutLoad } from './$types';

// The whole /read subtree is built to a fully static site (SPEC.md §2/§13 milestone 1).
export const prerender = true;

export const load: LayoutLoad = async ({ fetch }) => {
	const slug = DEFAULT_BOOK_SLUG;
	const book = await loadBook(slug, fetch);
	return { slug, book };
};
