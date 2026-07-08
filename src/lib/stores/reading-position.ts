/**
 * Per-book reading position, persisted to localStorage so "continue reading"
 * survives reloads. Keyed by book slug (SPEC.md §8: "per-book user data...
 * keyed by book slug so multiple loaded books don't collide").
 */

const STORAGE_PREFIX = 'genoer:reading-position:';

export interface ReadingPosition {
	sectionId: string;
	savedAt: number;
}

function storageAvailable(): boolean {
	return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function savePosition(slug: string, sectionId: string): void {
	if (!storageAvailable()) return;
	try {
		const position: ReadingPosition = { sectionId, savedAt: Date.now() };
		window.localStorage.setItem(STORAGE_PREFIX + slug, JSON.stringify(position));
	} catch {
		// localStorage unavailable (private browsing, quota, etc.) — reading position is a nicety, not critical.
	}
}

export function getPosition(slug: string): ReadingPosition | null {
	if (!storageAvailable()) return null;
	try {
		const raw = window.localStorage.getItem(STORAGE_PREFIX + slug);
		return raw ? (JSON.parse(raw) as ReadingPosition) : null;
	} catch {
		return null;
	}
}
