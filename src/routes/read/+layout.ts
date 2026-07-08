import { loadBook, DEFAULT_BOOK_SLUG } from '$lib/data/book';
import { loadGraph, buildGraphIndex } from '$lib/data/graph';
import type { LayoutLoad } from './$types';

// The whole /read subtree is built to a fully static site (SPEC.md §2/§13 milestone 1).
export const prerender = true;

export const load: LayoutLoad = async ({ fetch }) => {
	const slug = DEFAULT_BOOK_SLUG;
	const [book, graphData] = await Promise.all([loadBook(slug, fetch), loadGraph(slug, fetch)]);
	// graph.json is optional (SPEC.md §8) — `loadGraph` already resolves null rather than throwing
	// on a missing/malformed graph, so the reader stays fully functional without it.
	const graph = graphData ? buildGraphIndex(graphData) : null;
	return { slug, book, graph };
};
