/**
 * Types for the graph-assisted retrieval pipeline (SPEC.md §5 "Grounding
 * pipeline"). Deliberately structural and decoupled from `$lib/data/book` and
 * the concrete graph.json shape so these functions stay pure and unit-testable
 * with tiny inline fixtures — the real `Book` / graph objects are assignable to
 * them structurally.
 */

export interface RetrievalBlock {
	anchor: string;
	text: string;
	tokens: number;
	heading?: string | null;
}

export interface RetrievalSection {
	id: string;
	number: string | null;
	title: string;
	blocks: RetrievalBlock[];
}

export interface RetrievalBook {
	title?: string;
	sections: RetrievalSection[];
}

// ---- graph.json shape (subset we traverse) ---------------------------------

export interface GraphConcept {
	id: string; // "concept:<slug>"
	term: string;
	definition: string;
	chapter: number | null;
	defined_in: string; // bare module/section id, e.g. "m71114"
}

export interface GraphEdge {
	type: string; // "defines" | "mentions" | ...
	source: string; // "concept:<slug>"
	target: string; // "section:<module>"
	weight?: number;
}

export interface Graph {
	nodes: { concepts: GraphConcept[] };
	edges: GraphEdge[];
}

// ---- retrieval outputs ------------------------------------------------------

export interface MatchedConcept {
	concept: GraphConcept;
	/** The literal (normalized) span in the question that matched. */
	matchedText: string;
	/** Start index (in stemmed question tokens) and token length of the match. */
	start: number;
	length: number;
}

export interface RankedSection {
	sectionId: string;
	score: number;
	reasons: string[];
}

/** A retrieved block the model is shown, with everything the UI needs to cite it. */
export interface Passage {
	/** 1-based citation index. */
	index: number;
	anchor: string;
	sectionId: string;
	sectionTitle: string;
	sectionNumber: string | null;
	heading: string | null;
	text: string;
	tokens: number;
	/** True when included because it defines a matched concept (always kept). */
	isDefinition: boolean;
}

export interface GroundedPrompt {
	system: string;
	user: string;
	passages: Passage[];
	matchedConcepts: MatchedConcept[];
	rankedSections: RankedSection[];
	/** True when retrieval fell back to current/first-section grounding. */
	usedFallback: boolean;
	/** Sum of passage token estimates. */
	usedTokens: number;
}

export interface RetrievalOptions {
	/** Section currently open in the reader (top ranking priority). */
	currentSectionId?: string | null;
	/** Token budget for retrieved passages (system prompt + history already reserved). */
	budgetTokens: number;
	/** Book title, for the system prompt. */
	bookTitle?: string;
}
