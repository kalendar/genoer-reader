import { loadBook, DEFAULT_BOOK_SLUG } from '$lib/data/book';
import type { Graph } from '$lib/retrieval';
import type { PageLoad } from './$types';

// Static shell (SPEC.md §2); the model and all inference are client-side.
export const prerender = true;

/** Best-effort graph fetch — a book without a graph.json still gets page-grounded chat (SPEC §5). */
async function loadGraph(slug: string, fetchImpl: typeof fetch): Promise<Graph | null> {
	try {
		const res = await fetchImpl(`/books/${slug}/graph.json`);
		if (!res.ok) return null;
		return (await res.json()) as Graph;
	} catch {
		return null;
	}
}

export const load: PageLoad = async ({ fetch }) => {
	const slug = DEFAULT_BOOK_SLUG;
	const [book, graph] = await Promise.all([loadBook(slug, fetch), loadGraph(slug, fetch)]);
	return { slug, book, graph };
};
