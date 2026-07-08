/**
 * Per-book set of visited section ids, persisted to localStorage — powers the "Before you read"
 * panel's optional dimming of prerequisites the reader has already encountered (SPEC.md §4).
 * Mirrors the storage conventions of `$lib/stores/reading-position.ts`.
 */

const STORAGE_PREFIX = 'genoer:visited-sections:';

function storageAvailable(): boolean {
	return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getVisitedSections(slug: string): Set<string> {
	if (!storageAvailable()) return new Set();
	try {
		const raw = window.localStorage.getItem(STORAGE_PREFIX + slug);
		return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
	} catch {
		return new Set();
	}
}

export function markSectionVisited(slug: string, sectionId: string): Set<string> {
	const visited = getVisitedSections(slug);
	visited.add(sectionId);
	if (storageAvailable()) {
		try {
			window.localStorage.setItem(STORAGE_PREFIX + slug, JSON.stringify([...visited]));
		} catch {
			// localStorage unavailable — dimming is a nicety, not critical.
		}
	}
	return visited;
}
