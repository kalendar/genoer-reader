import { error } from '@sveltejs/kit';
import { resolveActiveBook, BookLoadError } from '$lib/data/resolve-book';
import { readBookParam } from '$lib/data/book-source';
import type { Graph } from '$lib/retrieval';
import type { PageLoad } from './$types';

// Static shell (SPEC.md §2); the model and all inference are client-side. A `?book=` param
// (SPEC.md §8) resolves client-side, same as every other route.
export const prerender = true;

export const load: PageLoad = async ({ fetch, url }) => {
	try {
		const { slug, book, graph } = await resolveActiveBook({ fetch, bookParam: readBookParam(url) });
		return { slug, book, graph: graph as Graph | null };
	} catch (err) {
		const message = err instanceof BookLoadError || err instanceof Error ? err.message : String(err);
		error(400, message);
	}
};
