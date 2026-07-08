import { error } from '@sveltejs/kit';
import { resolveActiveBook, BookLoadError } from '$lib/data/resolve-book';
import { readBookParam } from '$lib/data/book-source';
import { buildGraphIndex } from '$lib/data/graph';
import type { PageLoad } from './$types';

// The map route itself is a fully static page (SPEC.md §2); all view/selection state lives in the
// URL's query string and is applied client-side via shallow routing, so it never affects what gets
// prerendered here — see +page.svelte. A `?book=` param (SPEC.md §8) resolves client-side.
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
