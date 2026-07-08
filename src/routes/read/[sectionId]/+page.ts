import { error } from '@sveltejs/kit';
import { findSectionIndex } from '$lib/data/book';
import type { PageLoad } from './$types';

// Mirrors /read (SPEC.md §2/§13 milestone 1) — a fully static page per section of the bundled book;
// a `?book=` param (SPEC.md §8) is resolved once by the parent `/read` layout (`parent()` below)
// rather than re-fetched here.
export const prerender = true;

export const load: PageLoad = async ({ params, parent }) => {
	const { slug, book } = await parent();
	const index = findSectionIndex(book, params.sectionId);
	if (index === -1) {
		error(404, `No such section: "${params.sectionId}"`);
	}
	return {
		slug,
		section: book.sections[index],
		prev: index > 0 ? book.sections[index - 1] : null,
		next: index < book.sections.length - 1 ? book.sections[index + 1] : null
	};
};
