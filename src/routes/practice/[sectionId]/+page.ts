import { error } from '@sveltejs/kit';
import { findSectionIndex } from '$lib/data/book';
import { resolveActiveBook, BookLoadError } from '$lib/data/resolve-book';
import { readBookParam } from '$lib/data/book-source';
import type { PageLoad } from './$types';

export const prerender = true;

export const load: PageLoad = async ({ params, fetch, url }) => {
	let slug: string;
	let book: Awaited<ReturnType<typeof resolveActiveBook>>['book'];
	try {
		({ slug, book } = await resolveActiveBook({ fetch, bookParam: readBookParam(url) }));
	} catch (err) {
		const message = err instanceof BookLoadError || err instanceof Error ? err.message : String(err);
		error(400, message);
	}
	const index = findSectionIndex(book, params.sectionId);
	if (index === -1) {
		error(404, `No such section: "${params.sectionId}"`);
	}
	return { slug, section: book.sections[index] };
};
