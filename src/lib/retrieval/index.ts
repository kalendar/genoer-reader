/**
 * Public surface of the graph-assisted retrieval pipeline (SPEC.md §5).
 * The chat feature calls `buildGroundedPrompt`; the rest is exported for tests
 * and for the "Grounded on these passages" transparency panel.
 */
export { buildGroundedPrompt } from './prompt';
export { buildGraphIndex, matchConcepts, type GraphIndex } from './graph';
export { rankSections, selectBlocks, selectFallbackBlocks } from './rank';
export { normalizeText, stemToken, tokenize } from './normalize';
export type {
	Graph,
	GraphConcept,
	GraphEdge,
	GroundedPrompt,
	MatchedConcept,
	Passage,
	RankedSection,
	RetrievalBook,
	RetrievalBlock,
	RetrievalSection,
	RetrievalOptions
} from './types';
