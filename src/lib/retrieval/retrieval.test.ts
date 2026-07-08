/**
 * Unit tests for the graph-assisted retrieval pipeline (SPEC.md §5).
 * Run with: `node --test src/lib/retrieval/*.test.ts` (see package.json "test").
 *
 * Uses only relative imports (no `$lib` alias) and tiny inline fixtures so the
 * pure retrieval functions run under Node's native TS test runner with zero
 * build step.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tokenize, stemToken, normalizeText } from './normalize.ts';
import { buildGraphIndex, matchConcepts } from './graph.ts';
import { rankSections, selectBlocks, selectFallbackBlocks } from './rank.ts';
import { buildGroundedPrompt } from './prompt.ts';
import type { Graph, RetrievalBook } from './types.ts';

// ---- fixtures ---------------------------------------------------------------

const graph: Graph = {
	nodes: {
		concepts: [
			{ id: 'concept:business-plan', term: 'business plan', definition: 'a plan', chapter: 1, defined_in: 's2' },
			{ id: 'concept:business', term: 'business', definition: 'a business', chapter: 1, defined_in: 's1' },
			{ id: 'concept:entrepreneur', term: 'entrepreneur', definition: 'a founder', chapter: 1, defined_in: 's1' },
			{ id: 'concept:pivot', term: 'pivot', definition: 'a strategy change', chapter: 2, defined_in: 's3' }
		]
	},
	edges: [
		{ type: 'defines', source: 'concept:business-plan', target: 'section:s2' },
		{ type: 'defines', source: 'concept:business', source_note: '', target: 'section:s1' } as never,
		{ type: 'defines', source: 'concept:entrepreneur', target: 'section:s1' },
		{ type: 'defines', source: 'concept:pivot', target: 'section:s3' },
		{ type: 'mentions', source: 'concept:business-plan', target: 'section:s1', weight: 2 },
		{ type: 'mentions', source: 'concept:business-plan', target: 'section:s3', weight: 1 },
		{ type: 'mentions', source: 'concept:entrepreneur', target: 'section:s2', weight: 1 }
	]
};

const book: RetrievalBook = {
	title: 'Test Book',
	sections: [
		{
			id: 's1',
			number: '1.1',
			title: 'Foundations',
			blocks: [
				{ anchor: 's1-b1', text: 'An entrepreneur starts a business.', tokens: 10, heading: 'Intro' },
				{ anchor: 's1-b2', text: 'A business creates value.', tokens: 8, heading: null }
			]
		},
		{
			id: 's2',
			number: '1.2',
			title: 'Planning',
			blocks: [
				{ anchor: 's2-b1', text: 'A business plan describes the venture.', tokens: 12, heading: null },
				{ anchor: 's2-b2', text: 'It includes financials and strategy.', tokens: 30, heading: null }
			]
		},
		{
			id: 's3',
			number: '2.1',
			title: 'Growth',
			blocks: [{ anchor: 's3-b1', text: 'A pivot changes the strategy.', tokens: 9, heading: null }]
		}
	]
};

// ---- normalize --------------------------------------------------------------

test('stemToken handles simple plurals', () => {
	assert.equal(stemToken('entrepreneurs'), 'entrepreneur');
	assert.equal(stemToken('businesses'), 'business');
	assert.equal(stemToken('strategies'), 'strategy');
	assert.equal(stemToken('business'), 'business'); // -ss preserved
	assert.equal(stemToken('bus'), 'bus'); // too short to strip
});

test('normalizeText lowercases and strips punctuation', () => {
	assert.equal(normalizeText('What IS a Business-Plan?!'), 'what is a business plan');
});

test('tokenize normalizes + stems', () => {
	assert.deepEqual(tokenize('Two Entrepreneurs, one business!'), ['two', 'entrepreneur', 'one', 'business']);
});

// ---- matching ---------------------------------------------------------------

test('matchConcepts detects multi-word terms and prefers the longest', () => {
	const idx = buildGraphIndex(graph);
	const matches = matchConcepts('How do I write a business plan?', idx);
	const ids = matches.map((m) => m.concept.id);
	assert.ok(ids.includes('concept:business-plan'), 'matched multi-word term');
	assert.ok(!ids.includes('concept:business'), 'shorter contained term dropped');
});

test('matchConcepts is plural/case tolerant', () => {
	const idx = buildGraphIndex(graph);
	const matches = matchConcepts('What do Entrepreneurs do?', idx);
	assert.deepEqual(matches.map((m) => m.concept.id), ['concept:entrepreneur']);
});

test('matchConcepts returns empty when nothing matches', () => {
	const idx = buildGraphIndex(graph);
	assert.equal(matchConcepts('Tell me about the weather today', idx).length, 0);
});

// ---- ranking ----------------------------------------------------------------

test('rankSections ranks current > defines > mentions and is weight-aware', () => {
	const idx = buildGraphIndex(graph);
	const matches = matchConcepts('business plan and entrepreneur', idx);
	const ranked = rankSections(matches, idx, { currentSectionId: 's3' });

	// s3 is current (huge boost) even though it only mentions/ defines pivot-less.
	assert.equal(ranked[0].sectionId, 's3');
	assert.ok(ranked[0].reasons.some((r) => r.includes('currently open')));

	// Among the rest, s2 defines business-plan (10) + mentions entrepreneur (3) = 13;
	// s1 defines entrepreneur (10) + mentions business-plan w2 (6) = 16 → s1 outranks s2.
	const s1 = ranked.find((r) => r.sectionId === 's1');
	const s2 = ranked.find((r) => r.sectionId === 's2');
	assert.ok(s1 && s2 && s1.score > s2.score, 'weighted mentions lift s1 above s2');
});

// ---- block selection --------------------------------------------------------

test('selectBlocks always includes a matched concept defining block, honoring budget', () => {
	const idx = buildGraphIndex(graph);
	const matches = matchConcepts('business plan', idx);
	const ranked = rankSections(matches, idx, {});
	// Tiny budget: only ~12 tokens. The defining block (s2-b1, "business plan
	// describes...") must appear despite the 30-token block s2-b2 not fitting.
	const passages = selectBlocks(ranked, book, matches, 12);
	const anchors = passages.map((p) => p.anchor);
	assert.ok(anchors.includes('s2-b1'), 'defining block included');
	assert.ok(!anchors.includes('s2-b2'), 'over-budget non-required block excluded');
	assert.ok(passages.find((p) => p.anchor === 's2-b1')?.isDefinition, 'flagged as definition');
});

test('selectBlocks assigns sequential 1-based citation indices', () => {
	const idx = buildGraphIndex(graph);
	const matches = matchConcepts('entrepreneur', idx);
	const ranked = rankSections(matches, idx, {});
	const passages = selectBlocks(ranked, book, matches, 1000);
	passages.forEach((p, i) => assert.equal(p.index, i + 1));
});

test('selectFallbackBlocks uses the current section', () => {
	const passages = selectFallbackBlocks(book, 1000, 's3');
	assert.deepEqual(passages.map((p) => p.sectionId), ['s3']);
});

// ---- end-to-end prompt ------------------------------------------------------

test('buildGroundedPrompt grounds on matched concepts', () => {
	const gp = buildGroundedPrompt('What is a business plan?', book, graph, {
		budgetTokens: 1000,
		bookTitle: 'Test Book'
	});
	assert.equal(gp.usedFallback, false);
	assert.ok(gp.matchedConcepts.some((m) => m.concept.id === 'concept:business-plan'));
	assert.ok(gp.user.includes('[s2-b1]'), 'passage cited by anchor in the prompt');
	assert.ok(gp.system.includes('ONLY'), 'system prompt enforces grounding');
});

test('buildGroundedPrompt falls back to current section when no graph', () => {
	const gp = buildGroundedPrompt('anything at all', book, null, {
		budgetTokens: 1000,
		currentSectionId: 's2'
	});
	assert.equal(gp.usedFallback, true);
	assert.deepEqual([...new Set(gp.passages.map((p) => p.sectionId))], ['s2']);
});

test('buildGroundedPrompt falls back when the graph yields no match', () => {
	const gp = buildGroundedPrompt('weather forecast tomorrow', book, graph, {
		budgetTokens: 1000,
		currentSectionId: 's1'
	});
	assert.equal(gp.usedFallback, true);
	assert.equal(gp.matchedConcepts.length, 0);
	assert.deepEqual([...new Set(gp.passages.map((p) => p.sectionId))], ['s1']);
});
