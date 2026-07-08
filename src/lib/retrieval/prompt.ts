/**
 * Grounded prompt assembly (SPEC.md §5 step 5) and the top-level
 * `buildGroundedPrompt` entry point that ties matching → ranking → selection
 * together, including the no-graph / no-match fallback to current-section
 * grounding.
 */
import { buildGraphIndex, matchConcepts, type GraphIndex } from './graph.ts';
import { rankSections, selectBlocks, selectFallbackBlocks } from './rank.ts';
import type {
	Graph,
	GroundedPrompt,
	MatchedConcept,
	Passage,
	RankedSection,
	RetrievalBook,
	RetrievalOptions
} from './types';

function systemPrompt(bookTitle?: string): string {
	const book = bookTitle ? `the textbook "${bookTitle}"` : 'an open textbook';
	return [
		`You are a study assistant for ${book}.`,
		'Answer the student\'s question using ONLY the numbered passages provided below.',
		'If the passages do not contain the answer, say so plainly and do not use outside knowledge.',
		'Cite every claim with the passage id in square brackets, exactly as given, e.g. [m71114-b4].',
		'Be concise and clear.'
	].join(' ');
}

function renderPassages(passages: Passage[]): string {
	return passages
		.map((p) => {
			const loc = p.sectionNumber
				? `Section ${p.sectionNumber} — ${p.sectionTitle}`
				: p.sectionTitle;
			return `[${p.anchor}] (${loc})\n${p.text}`;
		})
		.join('\n\n');
}

function userPrompt(passages: Passage[], question: string): string {
	if (passages.length === 0) {
		return `No passages were retrieved. Question: ${question}`;
	}
	return `Passages:\n\n${renderPassages(passages)}\n\nQuestion: ${question}`;
}

/**
 * Build a grounded prompt from a single, already-known passage rather than
 * running retrieval (SPEC.md §7 "Explain-selected-text"). The reader's
 * selection toolbar already knows exactly which block a selection came
 * from — there's nothing to retrieve. Reuses the same system/user prompt
 * rendering as `buildGroundedPrompt` so seeded turns look identical to
 * retrieved ones (citations, the "Grounded on passages" panel, etc.).
 */
export function buildSeededGroundedPrompt(
	question: string,
	passage: Passage,
	bookTitle?: string
): GroundedPrompt {
	return {
		system: systemPrompt(bookTitle),
		user: userPrompt([passage], question),
		passages: [passage],
		matchedConcepts: [],
		rankedSections: [],
		usedFallback: false,
		usedTokens: passage.tokens
	};
}

/**
 * Build a fully grounded prompt for a question (SPEC §5 grounding pipeline).
 * Pass `graph = null` for books without a graph.json — retrieval degrades to
 * current-section grounding automatically.
 */
export function buildGroundedPrompt(
	question: string,
	book: RetrievalBook,
	graph: Graph | null,
	opts: RetrievalOptions
): GroundedPrompt {
	let matched: MatchedConcept[] = [];
	let ranked: RankedSection[] = [];
	let passages: Passage[] = [];
	let usedFallback = false;

	if (graph) {
		const index: GraphIndex = buildGraphIndex(graph);
		matched = matchConcepts(question, index);
		if (matched.length > 0) {
			ranked = rankSections(matched, index, { currentSectionId: opts.currentSectionId });
			passages = selectBlocks(ranked, book, matched, opts.budgetTokens);
		}
	}

	if (passages.length === 0) {
		usedFallback = true;
		passages = selectFallbackBlocks(book, opts.budgetTokens, opts.currentSectionId);
	}

	const usedTokens = passages.reduce((sum, p) => sum + p.tokens, 0);

	return {
		system: systemPrompt(opts.bookTitle ?? book.title),
		user: userPrompt(passages, question),
		passages,
		matchedConcepts: matched,
		rankedSections: ranked,
		usedFallback,
		usedTokens
	};
}
