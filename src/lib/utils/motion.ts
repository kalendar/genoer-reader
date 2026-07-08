/** SPEC.md §10 accessibility: "`prefers-reduced-motion` respected (map animations, scroll
 * behaviors)". The concept map's Cytoscape layouts already run with `animate: false`
 * unconditionally (see `ConceptMapCanvas.svelte`); this covers the one other motion in the app —
 * the reader's smooth-scroll-to-block on deep links and flash-highlight transitions. */
export function prefersReducedMotion(): boolean {
	return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}
