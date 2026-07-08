import { loadBook, DEFAULT_BOOK_SLUG } from '$lib/data/book';
import { loadGraph, buildGraphIndex } from '$lib/data/graph';
import type { PageLoad } from './$types';

// The map route itself is a fully static page (SPEC.md §2); all view/selection state lives in the
// URL's query string and is applied client-side via shallow routing, so it never affects what gets
// prerendered here — see +page.svelte.
export const prerender = true;

export const load: PageLoad = async ({ fetch }) => {
	const slug = DEFAULT_BOOK_SLUG;
	const [book, graphData] = await Promise.all([loadBook(slug, fetch), loadGraph(slug, fetch)]);
	const graph = graphData ? buildGraphIndex(graphData) : null;
	return { slug, book, graph };
};
