/**
 * Practice history persistence (SPEC.md §7 "Practice questions" — "Practice
 * history is local"). localStorage only, keyed by book slug (SPEC.md §8),
 * mirroring `$lib/stores/chat.ts`'s plain load/save shape rather than
 * `$lib/stores/highlights.ts`'s reactive-store shape — practice sessions are
 * owned by a single route (`/practice/[sectionId]`) at a time, the same way
 * chat turns are owned by `ChatPanel`, so there's no cross-component
 * reactivity to coordinate.
 */
import type { PracticeAttempt, PracticeSession } from '$lib/practice/types';

const STORAGE_PREFIX = 'genoer:practice:';
/** Cap stored sessions per book so localStorage doesn't grow unbounded across many visits. */
const MAX_SESSIONS = 50;

function storageAvailable(): boolean {
	return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function loadSessions(slug: string): PracticeSession[] {
	if (!storageAvailable()) return [];
	try {
		const raw = window.localStorage.getItem(STORAGE_PREFIX + slug);
		return raw ? (JSON.parse(raw) as PracticeSession[]) : [];
	} catch {
		return [];
	}
}

function saveSessions(slug: string, sessions: PracticeSession[]): void {
	if (!storageAvailable()) return;
	try {
		window.localStorage.setItem(STORAGE_PREFIX + slug, JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
	} catch {
		/* quota / private mode — non-fatal */
	}
}

/** Prepend a freshly generated session to this book's practice history. */
export function addSession(slug: string, session: PracticeSession): PracticeSession[] {
	const next = [session, ...loadSessions(slug)];
	saveSessions(slug, next);
	return next;
}

/** Record (or overwrite) a graded attempt within an existing session. */
export function recordAttempt(
	slug: string,
	sessionId: string,
	questionId: string,
	attempt: PracticeAttempt
): PracticeSession[] {
	const sessions = loadSessions(slug);
	const next = sessions.map((s) =>
		s.id === sessionId ? { ...s, attempts: { ...s.attempts, [questionId]: attempt } } : s
	);
	saveSessions(slug, next);
	return next;
}

export function clearPracticeHistory(slug: string): void {
	if (!storageAvailable()) return;
	try {
		window.localStorage.removeItem(STORAGE_PREFIX + slug);
	} catch {
		/* ignore */
	}
}

export function sectionSessions(slug: string, sectionId: string): PracticeSession[] {
	return loadSessions(slug).filter((s) => s.sectionId === sectionId);
}

/** Merge previously exported sessions into this book's history, deduped by id (non-destructive —
 * SPEC.md §9 "Retain" import). Returns the count actually added. */
export function importSessions(slug: string, sessions: PracticeSession[]): number {
	const existing = loadSessions(slug);
	const existingIds = new Set(existing.map((s) => s.id));
	const toAdd = sessions.filter((s) => s && typeof s.id === 'string' && !existingIds.has(s.id));
	if (toAdd.length === 0) return 0;
	saveSessions(slug, [...toAdd, ...existing]);
	return toAdd.length;
}
