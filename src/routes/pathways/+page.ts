import { loadBook, DEFAULT_BOOK_SLUG } from '$lib/data/book';
import { loadGraph, buildGraphIndex } from '$lib/data/graph';
import type { PageLoad } from './$types';

// Static page (SPEC.md §2); the chosen concept lives in the URL's query string and is applied
// client-side (see +page.svelte), same pattern as /map.
export const prerender = true;

export const load: PageLoad = async ({ fetch }) => {
	const slug = DEFAULT_BOOK_SLUG;
	const [book, graphData] = await Promise.all([loadBook(slug, fetch), loadGraph(slug, fetch)]);
	const graph = graphData ? buildGraphIndex(graphData) : null;
	return { slug, book, graph };
};
