/**
 * Prompt assembly for the practice-questions feature (SPEC.md §7 "Practice
 * questions" — "the on-device model generates self-check questions grounded
 * on that section's blocks — multiple-choice and short-answer"). Mirrors
 * `$lib/retrieval/prompt.ts`'s style: pure string-building, no engine calls.
 */
import type { GeneratedQuestion, PracticeBlock } from './types';

function renderPassages(blocks: PracticeBlock[]): string {
	return blocks
		.map((b) => `[${b.anchor}]${b.heading ? ` (${b.heading})` : ''}\n${b.text}`)
		.join('\n\n');
}

/**
 * Prompt-size ceiling for the passage portion. Empirical (see the
 * /dev/engine-test harness, 2026-07-08): on-device WebGPU prefill is ~3s at
 * ~1.5k total prompt tokens and degrades sharply past ~2k on the pinned
 * runtime — long sections (some run 10k+ tokens) must be trimmed, not dumped.
 */
const PASSAGE_TOKEN_BUDGET = 1000;

function capBlocks(blocks: PracticeBlock[], budget = PASSAGE_TOKEN_BUDGET): PracticeBlock[] {
	const out: PracticeBlock[] = [];
	let used = 0;
	for (const b of blocks) {
		const t = Math.ceil(b.text.length / 4);
		if (used + t > budget && out.length > 0) break;
		used += t;
		out.push(b);
	}
	return out;
}

/** Build the generation prompt: grounded ONLY on this section's blocks (trimmed
 * to the prompt-size ceiling), a mix of multiple-choice and short-answer
 * questions, each tagged with the passage id it comes from. */
export function buildPracticePrompt(
	sectionTitle: string,
	allBlocks: PracticeBlock[],
	count = 5
): { system: string; user: string } {
	const blocks = capBlocks(allBlocks);
	const system = [
		'You write short self-check study questions for students, grounded ONLY in the numbered passages given.',
		'Every question must be answerable from exactly one passage, and you must record that passage\'s bracketed id as "anchor".',
		'Produce a mix of multiple-choice and short-answer questions.',
		'Respond with ONLY a JSON array — no prose before or after, no markdown code fences, no comments.',
		'Each array element must match exactly one of these two shapes:',
		'{"type":"mc","anchor":"<passage id>","prompt":"...","choices":["...","...","...","..."],"correctIndex":0}',
		'{"type":"short","anchor":"<passage id>","prompt":"..."}',
		'Multiple-choice questions must have exactly 4 choices; correctIndex is the 0-based index of the correct one.',
		'Do not invent an anchor id that isn\'t one of the bracketed ids given below.'
	].join(' ');

	const user = [
		`Passages from "${sectionTitle}":`,
		'',
		renderPassages(blocks),
		'',
		`Generate ${count} self-check questions (a mix of multiple-choice and short-answer) as a JSON array, following the format exactly.`
	].join('\n');

	return { system, user };
}

/** Build the grading prompt for a short-answer response (SPEC.md §7: "the model evaluates the
 * user's response against the source block and gives feedback that cites it"). */
export function buildEvaluationPrompt(
	question: GeneratedQuestion,
	sourceText: string,
	userAnswer: string
): { system: string; user: string } {
	const system = [
		"You grade a student's short-answer response against a single source passage from a textbook.",
		'Judge only using the passage; do not use outside knowledge, and do not penalize wording that differs from the passage if the meaning is right.',
		'Respond with ONLY a JSON object — no prose, no markdown fences: {"correct": true|false, "feedback": "..."}',
		'The feedback must be 1-3 sentences and must quote or closely paraphrase the passage to justify the verdict.'
	].join(' ');

	const user = [
		'Passage:',
		sourceText,
		'',
		`Question: ${question.prompt}`,
		'',
		`Student's answer: ${userAnswer}`,
		'',
		'Grade it.'
	].join('\n');

	return { system, user };
}
