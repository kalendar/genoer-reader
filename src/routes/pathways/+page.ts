import { error } from '@sveltejs/kit';
import { resolveActiveBook, BookLoadError } from '$lib/data/resolve-book';
import { readBookParam } from '$lib/data/book-source';
import { buildGraphIndex } from '$lib/data/graph';
import type { PageLoad } from './$types';

// Static page (SPEC.md §2); the chosen concept lives in the URL's query string and is applied
// client-side (see +page.svelte), same pattern as /map. A `?book=` param (SPEC.md §8) resolves
// client-side.
export const prerender = true;

export const load: PageLoad = async ({ fetch, url }) => {
	try {
		const { slug, book, graph: graphData } = await resolveActiveBook({
			fetch,
			bookParam: readBookParam(url)
		});
		const graph = graphData ? buildGraphIndex(graphData) : null;
		return { slug, book, graph };
	} catch (err) {
		const message = err instanceof BookLoadError || err instanceof Error ? err.message : String(err);
		error(400, message);
	}
};
