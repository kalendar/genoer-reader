import { error } from '@sveltejs/kit';
import { loadBook, findSectionIndex, DEFAULT_BOOK_SLUG } from '$lib/data/book';
import type { PageLoad } from './$types';

// Mirrors /read/[sectionId] (SPEC.md §2/§13 milestone 1) — a fully static page per section.
export const prerender = true;

export const load: PageLoad = async ({ params, fetch }) => {
	const slug = DEFAULT_BOOK_SLUG;
	const book = await loadBook(slug, fetch);
	const index = findSectionIndex(book, params.sectionId);
	if (index === -1) {
		error(404, `No such section: "${params.sectionId}"`);
	}
	return { slug, section: book.sections[index] };
};
