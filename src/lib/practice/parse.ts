/**
 * Parse the on-device model's raw text output for the practice-questions
 * feature into structured, validated data (SPEC.md §7). Small local models
 * are not always perfectly JSON-disciplined (markdown fences, stray prose),
 * so this is deliberately tolerant: it looks for the largest bracketed/braced
 * span rather than requiring the whole response to be valid JSON, and it
 * silently drops individual malformed/ungrounded items rather than failing
 * the whole batch — but it never invents a question, and it enforces
 * "grounded ONLY on that section's blocks" by rejecting any anchor that
 * isn't in the caller-supplied set of valid anchors.
 */
import type { GeneratedQuestion, QuestionType } from './types';

/** Find the first JSON value in `text`, tolerating markdown code fences and leading/trailing prose. */
export function extractJson(text: string): unknown | null {
	const trimmed = text.trim();
	try {
		return JSON.parse(trimmed);
	} catch {
		/* fall through to bracket-scanning below */
	}
	const arrStart = trimmed.indexOf('[');
	const arrEnd = trimmed.lastIndexOf(']');
	if (arrStart !== -1 && arrEnd > arrStart) {
		try {
			return JSON.parse(trimmed.slice(arrStart, arrEnd + 1));
		} catch {
			/* fall through */
		}
	}
	const objStart = trimmed.indexOf('{');
	const objEnd = trimmed.lastIndexOf('}');
	if (objStart !== -1 && objEnd > objStart) {
		try {
			return JSON.parse(trimmed.slice(objStart, objEnd + 1));
		} catch {
			/* give up */
		}
	}
	return null;
}

let idCounter = 0;
function newQuestionId(): string {
	idCounter += 1;
	return `pq-${Date.now()}-${idCounter}`;
}

export interface ParsedQuestions {
	questions: GeneratedQuestion[];
	/** Set when nothing usable came out — the caller should surface this rather than an empty list. */
	error?: string;
}

/** Parse + validate the generation response. `validAnchors` enforces "grounded ONLY on that
 * section's blocks" — any question citing an anchor outside this set is dropped, not corrected. */
export function parseGeneratedQuestions(raw: string, validAnchors: Set<string>): ParsedQuestions {
	const data = extractJson(raw);
	if (!Array.isArray(data)) {
		return { questions: [], error: 'Could not parse questions from the model\'s output. Try generating again.' };
	}

	const questions: GeneratedQuestion[] = [];
	for (const item of data) {
		if (!item || typeof item !== 'object') continue;
		const obj = item as Record<string, unknown>;
		const type = obj.type as QuestionType;
		const anchor = obj.anchor;
		const prompt = obj.prompt;
		if (typeof prompt !== 'string' || !prompt.trim()) continue;
		if (typeof anchor !== 'string' || !validAnchors.has(anchor)) continue;

		if (type === 'mc') {
			const choices = obj.choices;
			const correctIndex = obj.correctIndex;
			if (!Array.isArray(choices) || choices.length < 2 || choices.length > 6) continue;
			if (!choices.every((c) => typeof c === 'string' && c.trim())) continue;
			if (typeof correctIndex !== 'number' || correctIndex < 0 || correctIndex >= choices.length) continue;
			questions.push({ id: newQuestionId(), type: 'mc', anchor, prompt, choices, correctIndex });
		} else if (type === 'short') {
			questions.push({ id: newQuestionId(), type: 'short', anchor, prompt });
		}
	}

	if (questions.length === 0) {
		return {
			questions: [],
			error: "The model didn't return any usable questions grounded on this section. Try again."
		};
	}
	return { questions };
}

export interface ParsedEvaluation {
	correct: boolean;
	feedback: string;
}

/** Parse + validate the grading response for a short-answer attempt. */
export function parseEvaluation(raw: string): ParsedEvaluation | null {
	const data = extractJson(raw);
	if (!data || typeof data !== 'object') return null;
	const obj = data as Record<string, unknown>;
	if (typeof obj.correct !== 'boolean' || typeof obj.feedback !== 'string' || !obj.feedback.trim()) {
		return null;
	}
	return { correct: obj.correct, feedback: obj.feedback };
}
