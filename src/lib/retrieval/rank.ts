/**
 * Section ranking + block selection (SPEC.md §5 steps 3–4). Pure functions.
 */
import type { GraphIndex } from './graph';
import type {
	MatchedConcept,
	Passage,
	RankedSection,
	RetrievalBook,
	RetrievalSection
} from './types';
import { normalizeText } from './normalize.ts';

// Ranking weights. Current section dominates (SPEC: "Prefer: the section
// currently open in the reader → sections that define → sections that mention").
const W_CURRENT = 100;
const W_DEFINES = 10;
const W_MENTIONS = 3;

interface Scored {
	score: number;
	reasons: string[];
}

/**
 * Rank sections for a set of matched concepts (SPEC §5 step 3), weighting
 * `defines` above `mentions`, folding in edge `weight`, and giving the
 * currently-open reader section a decisive boost.
 */
export function rankSections(
	matched: MatchedConcept[],
	index: GraphIndex,
	opts: { currentSectionId?: string | null } = {}
): RankedSection[] {
	const scores = new Map<string, Scored>();
	const bump = (section: string, delta: number, reason: string) => {
		const cur = scores.get(section) ?? { score: 0, reasons: [] };
		cur.score += delta;
		if (!cur.reasons.includes(reason)) cur.reasons.push(reason);
		scores.set(section, cur);
	};

	for (const m of matched) {
		for (const section of index.definesByConcept.get(m.concept.id) ?? []) {
			bump(section, W_DEFINES, `defines "${m.concept.term}"`);
		}
		for (const { section, weight } of index.mentionsByConcept.get(m.concept.id) ?? []) {
			bump(section, W_MENTIONS * (weight || 1), `mentions "${m.concept.term}"`);
		}
	}

	if (opts.currentSectionId) {
		bump(opts.currentSectionId, W_CURRENT, 'currently open in the reader');
	}

	return [...scores.entries()]
		.map(([sectionId, v]) => ({ sectionId, score: v.score, reasons: v.reasons }))
		.sort((a, b) => b.score - a.score);
}

/** Find the block within a section that best represents a concept's definition. */
function findDefiningBlock(section: RetrievalSection, term: string): string | null {
	const needle = normalizeText(term);
	for (const b of section.blocks) {
		if (normalizeText(b.text).includes(needle)) return b.anchor;
	}
	return section.blocks[0]?.anchor ?? null;
}

/**
 * Select blocks under a token budget (SPEC §5 step 4). The defining block of
 * every matched concept is ALWAYS included (even past budget); remaining budget
 * is filled from the top-ranked sections in document order.
 */
export function selectBlocks(
	ranked: RankedSection[],
	book: RetrievalBook,
	matched: MatchedConcept[],
	budgetTokens: number
): Passage[] {
	const sectionById = new Map(book.sections.map((s) => [s.id, s]));

	// 1. Must-include: defining block anchor per matched concept.
	const mustInclude = new Set<string>();
	for (const m of matched) {
		const sec = sectionById.get(m.concept.defined_in);
		if (!sec) continue;
		const anchor = findDefiningBlock(sec, m.concept.term);
		if (anchor) mustInclude.add(anchor);
	}

	// 2. Section walk order = ranked order, then any defining sections not ranked.
	const order: string[] = ranked.map((r) => r.sectionId);
	for (const m of matched) {
		if (!order.includes(m.concept.defined_in) && sectionById.has(m.concept.defined_in)) {
			order.push(m.concept.defined_in);
		}
	}

	const passages: Passage[] = [];
	const seen = new Set<string>();
	let used = 0;

	for (const sectionId of order) {
		const sec = sectionById.get(sectionId);
		if (!sec) continue;
		for (const block of sec.blocks) {
			if (seen.has(block.anchor)) continue;
			const required = mustInclude.has(block.anchor);
			if (!required && used + block.tokens > budgetTokens) continue;
			seen.add(block.anchor);
			used += block.tokens;
			passages.push({
				index: passages.length + 1,
				anchor: block.anchor,
				sectionId: sec.id,
				sectionTitle: sec.title,
				sectionNumber: sec.number,
				heading: block.heading ?? null,
				text: block.text,
				tokens: block.tokens,
				isDefinition: required
			});
		}
	}

	return passages;
}

/** Fallback grounding: the current (or first) section's blocks under budget. */
export function selectFallbackBlocks(
	book: RetrievalBook,
	budgetTokens: number,
	currentSectionId?: string | null
): Passage[] {
	const section =
		(currentSectionId && book.sections.find((s) => s.id === currentSectionId)) ||
		book.sections[0];
	if (!section) return [];

	const passages: Passage[] = [];
	let used = 0;
	for (const block of section.blocks) {
		if (used + block.tokens > budgetTokens && passages.length > 0) break;
		used += block.tokens;
		passages.push({
			index: passages.length + 1,
			anchor: block.anchor,
			sectionId: section.id,
			sectionTitle: section.title,
			sectionNumber: section.number,
			heading: block.heading ?? null,
			text: block.text,
			tokens: block.tokens,
			isDefinition: false
		});
	}
	return passages;
}
