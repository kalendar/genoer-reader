import { DEFAULT_BOOK_SLUG } from '$lib/data/book';
import type { PageLoad } from './$types';

// A static page — highlights/notes live entirely in localStorage and carry their own section
// titles/numbers at creation time (see $lib/stores/highlights.ts), so there's no book/graph fetch
// to do here beyond knowing which book slug's storage bucket to read.
export const prerender = true;

export const load: PageLoad = async () => {
	return { slug: DEFAULT_BOOK_SLUG };
};
