import { loadBook, DEFAULT_BOOK_SLUG } from '$lib/data/book';
import { loadGraph, buildGraphIndex } from '$lib/data/graph';
import type { PageLoad } from './$types';

// Always describes the bundled reference book by default (SPEC.md §9) — if the visitor has a
// different book loaded elsewhere this session, the page overrides with the live `currentBook`/
// `currentGraph` stores client-side (see +page.svelte); this load just guarantees there's always
// something correct to show even on a cold visit straight to /about.
export const prerender = true;

export const load: PageLoad = async ({ fetch }) => {
	const [book, graphData] = await Promise.all([
		loadBook(DEFAULT_BOOK_SLUG, fetch),
		loadGraph(DEFAULT_BOOK_SLUG, fetch)
	]);
	const graph = graphData ? buildGraphIndex(graphData) : null;
	return { slug: DEFAULT_BOOK_SLUG, book, graph };
};
