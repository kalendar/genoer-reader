/**
 * Types for the practice-questions feature (SPEC.md §7 "Practice questions").
 * Deliberately structural, mirroring `$lib/retrieval/types.ts`'s style, so
 * these stay decoupled from the concrete `Section`/`Block` shape.
 */

export type QuestionType = 'mc' | 'short';

export interface GeneratedQuestion {
	id: string;
	type: QuestionType;
	/** The block anchor this question is grounded on — "show me where this is covered" (SPEC.md §7). */
	anchor: string;
	prompt: string;
	/** Multiple-choice only. */
	choices?: string[];
	/** Multiple-choice only — 0-based index into `choices`. */
	correctIndex?: number;
}

export interface PracticeAttempt {
	questionId: string;
	/** Selected choice text (mc) or free-text response (short). */
	userAnswer: string;
	selectedIndex?: number;
	correct: boolean;
	/** Machine-generated feedback citing the source block (short-answer) or a plain correct/incorrect
	 * note (multiple-choice, computed locally — no model round-trip needed to grade it). */
	feedback: string;
	gradedAt: number;
}

export interface PracticeSession {
	id: string;
	sectionId: string;
	sectionTitle: string;
	sectionNumber: string | null;
	createdAt: number;
	questions: GeneratedQuestion[];
	/** Keyed by question id. */
	attempts: Record<string, PracticeAttempt>;
}

/** Minimal shape `buildPracticePrompt`/parsing needs from a section's blocks — assignable from
 * `$lib/data/book`'s `Block[]` structurally. */
export interface PracticeBlock {
	anchor: string;
	text: string;
	heading: string | null;
}
