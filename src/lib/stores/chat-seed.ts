/**
 * "Seeded context" hand-off from the reader's selection toolbar (SPEC.md §4
 * "Selection toolbar" / §7 "Explain-selected-text") into the chat pane
 * (SPEC.md §5).
 *
 * The reader knows exactly which block a selection came from — there's no
 * need to make the chat re-run graph retrieval to rediscover it. Explain /
 * Simplify / Give me an example set a `SeededContext` here and navigate to
 * `/chat`; `ChatPanel` consumes it once on mount and grounds the *next*
 * question directly on the enclosing block instead of running the normal
 * retrieval pipeline for that one turn (see `buildSeededGroundedPrompt` in
 * `$lib/retrieval`).
 *
 * A module-level variable survives SvelteKit's client-side navigation (no
 * full reload), which covers the normal case. `sessionStorage` is a fallback
 * for a hard reload landing on `/chat` mid-navigation — never `localStorage`,
 * because a seed is single-use scratch state, not persistent user data.
 */

export type SeedInstruction = 'explain' | 'simplify' | 'example';

export interface SeededContext {
	instruction: SeedInstruction;
	/** The literal text the reader selected. */
	selectionText: string;
	/** The full enclosing block's plain text — the grounded passage. */
	blockText: string;
	blockAnchor: string;
	/** Heading breadcrumb down to the block, for display and section context. */
	trail: string[];
	sectionId: string;
	sectionTitle: string;
	sectionNumber: string | null;
}

const STORAGE_KEY = 'genoer:chat-seed';

let pending: SeededContext | null = null;

function storageAvailable(): boolean {
	return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

export function setSeededContext(ctx: SeededContext): void {
	pending = ctx;
	if (storageAvailable()) {
		try {
			window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
		} catch {
			/* ignore — the in-memory copy still works for same-session navigation */
		}
	}
}

/** Consume (read + clear) the pending seed, if any. Single-use by design. */
export function consumeSeededContext(): SeededContext | null {
	if (pending) {
		const ctx = pending;
		pending = null;
		if (storageAvailable()) {
			try {
				window.sessionStorage.removeItem(STORAGE_KEY);
			} catch {
				/* ignore */
			}
		}
		return ctx;
	}
	if (storageAvailable()) {
		try {
			const raw = window.sessionStorage.getItem(STORAGE_KEY);
			if (raw) {
				window.sessionStorage.removeItem(STORAGE_KEY);
				return JSON.parse(raw) as SeededContext;
			}
		} catch {
			/* ignore */
		}
	}
	return null;
}

const INSTRUCTION_TEMPLATES: Record<SeedInstruction, (selection: string) => string> = {
	explain: (s) => `Explain this passage from the book: "${s}"`,
	simplify: (s) => `Simplify this passage in plain, simple terms: "${s}"`,
	example: (s) => `Give me a concrete, real-world example that illustrates this: "${s}"`
};

/** The default composer text for a seed, editable by the user before sending. */
export function seedQuestionText(ctx: SeededContext): string {
	return INSTRUCTION_TEMPLATES[ctx.instruction](ctx.selectionText);
}

export const INSTRUCTION_LABELS: Record<SeedInstruction, string> = {
	explain: 'Explain this',
	simplify: 'Simplify this',
	example: 'Give me an example'
};
