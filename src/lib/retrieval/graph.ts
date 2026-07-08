/**
 * Graph indexing + concept matching (SPEC.md §5 steps 1–2). The graph *is* the
 * retrieval index — no embeddings, no extra downloads.
 */
import { tokenize } from './normalize.ts';
import type { Graph, GraphConcept, MatchedConcept } from './types';

const SECTION_PREFIX = 'section:';

/** Precomputed lookups over a graph, built once per loaded book. */
export interface GraphIndex {
	conceptsById: Map<string, GraphConcept>;
	/** Concepts with their stemmed term tokens, longest-first (prefer multi-word). */
	conceptTokens: { concept: GraphConcept; tokens: string[] }[];
	/** conceptId → section module ids it *defines*. */
	definesByConcept: Map<string, string[]>;
	/** conceptId → sections it *mentions*, with edge weight. */
	mentionsByConcept: Map<string, { section: string; weight: number }[]>;
}

function stripSection(id: string): string {
	return id.startsWith(SECTION_PREFIX) ? id.slice(SECTION_PREFIX.length) : id;
}

export function buildGraphIndex(graph: Graph): GraphIndex {
	const conceptsById = new Map<string, GraphConcept>();
	const conceptTokens: { concept: GraphConcept; tokens: string[] }[] = [];
	for (const c of graph.nodes.concepts) {
		conceptsById.set(c.id, c);
		const tokens = tokenize(c.term);
		if (tokens.length > 0) conceptTokens.push({ concept: c, tokens });
	}
	// Longest term first so multi-word matches win over their component words.
	conceptTokens.sort((a, b) => b.tokens.length - a.tokens.length);

	const definesByConcept = new Map<string, string[]>();
	const mentionsByConcept = new Map<string, { section: string; weight: number }[]>();
	for (const e of graph.edges) {
		if (e.type === 'defines') {
			const arr = definesByConcept.get(e.source) ?? [];
			arr.push(stripSection(e.target));
			definesByConcept.set(e.source, arr);
		} else if (e.type === 'mentions') {
			const arr = mentionsByConcept.get(e.source) ?? [];
			arr.push({ section: stripSection(e.target), weight: e.weight ?? 1 });
			mentionsByConcept.set(e.source, arr);
		}
	}

	return { conceptsById, conceptTokens, definesByConcept, mentionsByConcept };
}

/** True if `needle` occurs as a contiguous subsequence of `haystack`, returning its start (or -1). */
function findSubsequence(haystack: string[], needle: string[]): number {
	if (needle.length === 0 || needle.length > haystack.length) return -1;
	outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
		for (let j = 0; j < needle.length; j++) {
			if (haystack[i + j] !== needle[j]) continue outer;
		}
		return i;
	}
	return -1;
}

/**
 * Match the question against the glossary vocabulary (SPEC §5 step 1).
 * Multi-word terms are matched as contiguous token subsequences; case and
 * simple plurals are handled by {@link tokenize}. When a longer term matches,
 * shorter terms fully contained inside the same span are dropped as noise
 * (e.g. "business plan" wins over "business" at the same position).
 */
export function matchConcepts(question: string, index: GraphIndex): MatchedConcept[] {
	const qTokens = tokenize(question);
	const accepted: MatchedConcept[] = [];

	for (const { concept, tokens } of index.conceptTokens) {
		const start = findSubsequence(qTokens, tokens);
		if (start === -1) continue;
		const end = start + tokens.length;
		// Drop if fully contained within an already-accepted (longer) match span.
		const contained = accepted.some(
			(m) => start >= m.start && end <= m.start + m.length
		);
		if (contained) continue;
		accepted.push({
			concept,
			matchedText: tokens.join(' '),
			start,
			length: tokens.length
		});
	}

	// Stable, readable order: by position in the question.
	accepted.sort((a, b) => a.start - b.start);
	return accepted;
}
