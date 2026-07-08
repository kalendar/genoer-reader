/**
 * The "current graph" store — parallels `$lib/stores/book.ts`. The graph is
 * optional (SPEC.md §2/§8): `currentGraph` is `null` both before load
 * resolves *and* permanently for a book that ships no `graph.json`. Any
 * component that wants map/pathway/glossary features must treat `null` as
 * "feature unavailable for this book," not as "still loading" — check
 * `graphAttempted` if that distinction matters.
 *
 * Usage from a later feature:
 *   import { currentGraph } from '$lib/stores/graph';
 *   if ($currentGraph) { ... }
 */
import { writable } from 'svelte/store';
import type { GraphIndex } from '$lib/data/graph';

/** Slug of the book the current graph belongs to (mirrors `currentBookSlug`). */
export const currentGraphSlug = writable<string | null>(null);

/** The currently open book's graph index, or `null` if none is loaded (yet, or ever). */
export const currentGraph = writable<GraphIndex | null>(null);

/** True once a load attempt has finished (success or not) — lets the UI distinguish "loading" from
 * "this book genuinely has no graph.json" without a separate loading store. */
export const graphAttempted = writable<boolean>(false);

/** Called by route `load` consumers once a graph fetch resolves (possibly to `null`). */
export function setCurrentGraph(slug: string, index: GraphIndex | null): void {
	currentGraphSlug.set(slug);
	currentGraph.set(index);
	graphAttempted.set(true);
}
