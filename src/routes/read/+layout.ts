import { error } from '@sveltejs/kit';
import { resolveActiveBook, BookLoadError } from '$lib/data/resolve-book';
import { readBookParam } from '$lib/data/book-source';
import { buildGraphIndex } from '$lib/data/graph';
import type { LayoutLoad } from './$types';

// The whole /read subtree is built to a fully static site for the bundled book (SPEC.md §2/§13
// milestone 1); a `?book=` param (SPEC.md §8) resolves client-side after hydration instead, since
// arbitrary URLs/local files obviously can't be prerendered — see `readBookParam`'s doc comment for
// why reading it isn't a plain `url.searchParams.get(...)` call.
export const prerender = true;

export const load: LayoutLoad = async ({ fetch, url }) => {
	try {
		const resolved = await resolveActiveBook({ fetch, bookParam: readBookParam(url) });
		const graph = resolved.graph ? buildGraphIndex(resolved.graph) : null;
		return { slug: resolved.slug, book: resolved.book, graph, source: resolved.source, warnings: resolved.warnings };
	} catch (err) {
		const message = err instanceof BookLoadError || err instanceof Error ? err.message : String(err);
		error(400, message);
	}
};
