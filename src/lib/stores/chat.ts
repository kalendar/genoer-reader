/**
 * Chat transcript persistence (SPEC.md §5 "Conversation": history stored
 * locally, clearable, exportable; §8 per-book user data keyed by slug).
 *
 * localStorage only — a student's questions never touch a server (§2/§10).
 * Each assistant turn keeps the retrieved passages and the grounding metadata
 * so the "Grounded on these passages" panel and citations survive a reload.
 */
import type { Passage } from '$lib/retrieval';
import type { Backend } from '$lib/engine';

const STORAGE_PREFIX = 'genoer:chat:';

export interface ChatTurn {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	/** Assistant turns: the passages the answer was grounded on. */
	passages?: Passage[];
	/** Assistant turns: matched glossary terms (for transparency). */
	matchedTerms?: string[];
	/** Assistant turns: whether retrieval fell back to section grounding. */
	usedFallback?: boolean;
	/** Assistant turns: backend + measured speed, if available. */
	backend?: Backend;
	tokensPerSecond?: number;
	createdAt: number;
}

function storageAvailable(): boolean {
	return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function loadHistory(slug: string): ChatTurn[] {
	if (!storageAvailable()) return [];
	try {
		const raw = window.localStorage.getItem(STORAGE_PREFIX + slug);
		return raw ? (JSON.parse(raw) as ChatTurn[]) : [];
	} catch {
		return [];
	}
}

export function saveHistory(slug: string, turns: ChatTurn[]): void {
	if (!storageAvailable()) return;
	try {
		window.localStorage.setItem(STORAGE_PREFIX + slug, JSON.stringify(turns));
	} catch {
		/* quota / private mode — non-fatal */
	}
}

export function clearHistory(slug: string): void {
	if (!storageAvailable()) return;
	try {
		window.localStorage.removeItem(STORAGE_PREFIX + slug);
	} catch {
		/* ignore */
	}
}

/** Export the transcript as a downloadable JSON blob (SPEC §5 "exportable"). */
export function exportHistory(slug: string, turns: ChatTurn[]): void {
	if (typeof document === 'undefined') return;
	const blob = new Blob([JSON.stringify({ slug, turns }, null, 2)], {
		type: 'application/json'
	});
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `genoer-chat-${slug}.json`;
	a.click();
	URL.revokeObjectURL(url);
}

export function newId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Merge previously exported turns into this book's history, deduped by id (non-destructive —
 * SPEC.md §9 "Retain" import). Returns the count actually added (new ids only). */
export function importHistory(slug: string, turns: ChatTurn[]): number {
	const existing = loadHistory(slug);
	const existingIds = new Set(existing.map((t) => t.id));
	const toAdd = turns.filter((t) => t && typeof t.id === 'string' && !existingIds.has(t.id));
	if (toAdd.length === 0) return 0;
	const merged = [...existing, ...toAdd].sort((a, b) => a.createdAt - b.createdAt);
	saveHistory(slug, merged);
	return toAdd.length;
}
