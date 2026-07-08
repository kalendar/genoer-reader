/**
 * Unit tests for `applyHighlights` (SPEC.md §7 "highlight rendering must
 * survive re-render and not corrupt block HTML").
 * Run with: `node --test src/lib/utils/*.test.ts` (see package.json "test").
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyHighlights } from './highlight-render.ts';

test('wraps a plain-text range in a single block of text', () => {
	const html = '<p>The quick brown fox jumps.</p>';
	const out = applyHighlights(html, [{ id: 'h1', start: 4, end: 15 }]);
	assert.equal(
		out,
		'<p>The <mark class="user-highlight" data-highlight-id="h1" tabindex="0" role="button" aria-haspopup="dialog">quick brown</mark> fox jumps.</p>'
	);
});

test('returns html unchanged when there are no ranges', () => {
	const html = '<p>Hello world.</p>';
	assert.equal(applyHighlights(html, []), html);
});

test('ignores zero-length or inverted ranges', () => {
	const html = '<p>Hello world.</p>';
	assert.equal(applyHighlights(html, [{ id: 'h1', start: 5, end: 5 }]), html);
	assert.equal(applyHighlights(html, [{ id: 'h1', start: 8, end: 3 }]), html);
});

test('splits the mark across an inline tag boundary rather than corrupting markup', () => {
	const html = '<p>abc<em>def</em>ghi</p>';
	// "textContent" is "abcdefghi"; highlight offsets 2..7 -> "cdefg"
	const out = applyHighlights(html, [{ id: 'h1', start: 2, end: 7 }]);
	assert.equal(
		out,
		'<p>ab<mark class="user-highlight" data-highlight-id="h1" tabindex="0" role="button" aria-haspopup="dialog">c</mark><em><mark class="user-highlight" data-highlight-id="h1" tabindex="-1" role="button" aria-haspopup="dialog">def</mark></em><mark class="user-highlight" data-highlight-id="h1" tabindex="-1" role="button" aria-haspopup="dialog">g</mark>hi</p>'
	);
	// Every opened mark is closed and nothing outside <em> leaks inside it.
	assert.equal((out.match(/<mark /g) ?? []).length, (out.match(/<\/mark>/g) ?? []).length);
});

test('supports overlapping ranges as nested marks, each independently addressable', () => {
	const html = '<p>abcdef</p>';
	const out = applyHighlights(html, [
		{ id: 'outer', start: 0, end: 6 },
		{ id: 'inner', start: 2, end: 4 }
	]);
	assert.match(out, /data-highlight-id="outer"/);
	assert.match(out, /data-highlight-id="inner"/);
	// Well-formed nesting: 3 opens, 3 closes (outer wraps [0,2), [2,4) doubly, [4,6) singly).
	assert.equal((out.match(/<mark /g) ?? []).length, (out.match(/<\/mark>/g) ?? []).length);
});

test('treats an HTML entity as a single visible character, and merges adjacent runs into one mark', () => {
	const html = '<p>Tom &amp; Jerry</p>';
	// textContent is "Tom & Jerry"; highlight "& Jerry" -> offsets 4..11
	const out = applyHighlights(html, [{ id: 'h1', start: 4, end: 11 }]);
	assert.equal(
		out,
		'<p>Tom <mark class="user-highlight" data-highlight-id="h1" tabindex="0" role="button" aria-haspopup="dialog">&amp; Jerry</mark></p>'
	);
});

test('never inserts a mark inside a tag\'s own attributes', () => {
	const html = '<p>See <a href="https://example.com/amp">this link</a> please.</p>';
	// textContent is "See this link please."; highlight the word "link" (offsets 9..13).
	const out = applyHighlights(html, [{ id: 'h1', start: 9, end: 13 }]);
	assert.doesNotMatch(out, /href="https:\/\/example\.com\/<mark/);
	assert.match(out, /<mark class="user-highlight" data-highlight-id="h1" tabindex="0" role="button" aria-haspopup="dialog">link<\/mark>/);
});
