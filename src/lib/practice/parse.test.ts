/**
 * Unit tests for practice-question parsing (SPEC.md §7 "Practice questions").
 * Run with: `node --test src/lib/practice/*.test.ts` (see package.json "test").
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractJson, parseGeneratedQuestions, parseEvaluation } from './parse.ts';

test('extractJson parses clean JSON', () => {
	assert.deepEqual(extractJson('[1,2,3]'), [1, 2, 3]);
});

test('extractJson strips markdown fences and leading prose', () => {
	const raw = 'Sure, here you go:\n```json\n[{"a":1}]\n```\nHope that helps!';
	assert.deepEqual(extractJson(raw), [{ a: 1 }]);
});

test('extractJson returns null for unparseable garbage', () => {
	assert.equal(extractJson('not json at all'), null);
});

test('parseGeneratedQuestions accepts valid mc and short questions grounded on known anchors', () => {
	const raw = JSON.stringify([
		{ type: 'mc', anchor: 'b1', prompt: 'What is X?', choices: ['a', 'b', 'c', 'd'], correctIndex: 2 },
		{ type: 'short', anchor: 'b2', prompt: 'Explain Y.' }
	]);
	const { questions, error } = parseGeneratedQuestions(raw, new Set(['b1', 'b2']));
	assert.equal(error, undefined);
	assert.equal(questions.length, 2);
	assert.equal(questions[0].type, 'mc');
	assert.equal(questions[0].choices?.length, 4);
	assert.equal(questions[1].type, 'short');
});

test('parseGeneratedQuestions drops questions citing an anchor outside the section', () => {
	const raw = JSON.stringify([
		{ type: 'short', anchor: 'not-in-section', prompt: 'Explain Z.' },
		{ type: 'short', anchor: 'b1', prompt: 'Explain Y.' }
	]);
	const { questions } = parseGeneratedQuestions(raw, new Set(['b1']));
	assert.equal(questions.length, 1);
	assert.equal(questions[0].anchor, 'b1');
});

test('parseGeneratedQuestions drops malformed mc questions (bad correctIndex, too few choices)', () => {
	const raw = JSON.stringify([
		{ type: 'mc', anchor: 'b1', prompt: 'Bad choices', choices: ['only one'], correctIndex: 0 },
		{ type: 'mc', anchor: 'b1', prompt: 'Bad index', choices: ['a', 'b'], correctIndex: 9 }
	]);
	const { questions, error } = parseGeneratedQuestions(raw, new Set(['b1']));
	assert.equal(questions.length, 0);
	assert.match(error ?? '', /didn't return any usable questions/);
});

test('parseGeneratedQuestions surfaces an error when the model output is not an array', () => {
	const { questions, error } = parseGeneratedQuestions('{"oops": true}', new Set(['b1']));
	assert.equal(questions.length, 0);
	assert.match(error ?? '', /Could not parse/);
});

test('parseEvaluation accepts a well-formed grading object', () => {
	const result = parseEvaluation('{"correct": true, "feedback": "Matches the passage."}');
	assert.deepEqual(result, { correct: true, feedback: 'Matches the passage.' });
});

test('parseEvaluation returns null for missing fields', () => {
	assert.equal(parseEvaluation('{"correct": true}'), null);
	assert.equal(parseEvaluation('not json'), null);
});
