/**
 * "Export everything" — one-button export/import of ALL local data across
 * every book this browser has ever opened (SPEC.md §9 "Retain": "one-button
 * export of everything local (annotations, chat, practice history) as
 * JSON"; the Milestone 5 brief widens the documented scope to also cover
 * reading positions and settings).
 *
 * Deliberately reuses the existing per-book export/import primitives
 * (`$lib/stores/highlights`'s `importAnnotations`, `$lib/stores/chat`'s
 * `importHistory`, `$lib/stores/practice`'s `importSessions`) rather than
 * re-implementing merge logic, so there's exactly one place each data type's
 * merge-by-id semantics live. Local *book content* (the book.json/graph.json
 * text a "load from file" saved to IndexedDB) is intentionally NOT part of
 * this export — it's fetched/re-obtainable content, not authored user data,
 * and would make the export file enormous.
 */
import { getStoredHighlightsAndNotes, importAnnotations } from '$lib/stores/highlights';
import { loadHistory, importHistory, type ChatTurn } from '$lib/stores/chat';
import { loadSessions, importSessions } from '$lib/stores/practice';
import { getPosition, savePosition, type ReadingPosition } from '$lib/stores/reading-position';
import { getVisitedSections, markSectionVisited } from '$lib/stores/visited-sections';
import { loadSettings, saveSettings, type ModelSettings } from '$lib/models/settings';
import { listRegisteredSources } from '$lib/data/book-source';
import { DEFAULT_BOOK_SLUG } from '$lib/data/book';

const KEY_PREFIXES = [
	'genoer:highlights:',
	'genoer:notes:',
	'genoer:chat:',
	'genoer:practice:',
	'genoer:reading-position:',
	'genoer:visited-sections:'
];

/** Every book slug this browser has local data for — from the book-source registry, the bundled
 * default, and (belt and braces) any localStorage key found under a per-book prefix, so a book
 * whose registry entry was later "forgotten" doesn't silently drop its still-present data. */
function discoverSlugs(): string[] {
	const slugs = new Set<string>([DEFAULT_BOOK_SLUG]);
	for (const s of listRegisteredSources()) slugs.add(s.slug);
	if (typeof window !== 'undefined' && window.localStorage) {
		for (let i = 0; i < window.localStorage.length; i++) {
			const key = window.localStorage.key(i);
			if (!key) continue;
			const prefix = KEY_PREFIXES.find((p) => key.startsWith(p));
			if (prefix) slugs.add(key.slice(prefix.length));
		}
	}
	return [...slugs];
}

interface BookDataExport {
	slug: string;
	highlights: unknown[];
	notes: unknown[];
	chatHistory: ChatTurn[];
	practiceSessions: unknown[];
	readingPosition: ReadingPosition | null;
	visitedSections: string[];
}

export interface FullExport {
	version: 1;
	kind: 'genoer-full-export';
	exportedAt: number;
	modelSettings: ModelSettings | null;
	books: BookDataExport[];
}

/** Gather every book's local data into one exportable object. */
export function collectAllData(): FullExport {
	const books = discoverSlugs().map((slug): BookDataExport => {
		const { highlights, notes } = getStoredHighlightsAndNotes(slug);
		return {
			slug,
			highlights,
			notes,
			chatHistory: loadHistory(slug),
			practiceSessions: loadSessions(slug),
			readingPosition: getPosition(slug),
			visitedSections: [...getVisitedSections(slug)]
		};
	});
	return {
		version: 1,
		kind: 'genoer-full-export',
		exportedAt: Date.now(),
		modelSettings: loadSettings(),
		books
	};
}

/** Trigger a download of everything (SPEC.md §9 "Retain"). */
export function exportAllData(): void {
	if (typeof document === 'undefined') return;
	const payload = collectAllData();
	const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `genoer-full-export-${new Date().toISOString().slice(0, 10)}.json`;
	a.click();
	URL.revokeObjectURL(url);
}

export interface ImportSummary {
	books: number;
	highlights: number;
	notes: number;
	chatTurns: number;
	practiceSessions: number;
	readingPositions: number;
	settingsApplied: boolean;
}

/** Import a previously exported file, merging into whatever's already here — never destructive
 * (SPEC.md §9). Throws a human-readable error on malformed input. */
export async function importAllData(file: File): Promise<ImportSummary> {
	const text = await file.text();
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error('That file is not valid JSON.');
	}
	const payload = data as Partial<FullExport> | null;
	if (!payload || payload.kind !== 'genoer-full-export' || !Array.isArray(payload.books)) {
		throw new Error(
			'That file doesn\'t look like a GenOER "export everything" file (expected kind "genoer-full-export" and a "books" array). Use the notebook page to import a highlights/notes-only export instead.'
		);
	}

	const summary: ImportSummary = {
		books: payload.books.length,
		highlights: 0,
		notes: 0,
		chatTurns: 0,
		practiceSessions: 0,
		readingPositions: 0,
		settingsApplied: false
	};

	for (const book of payload.books) {
		if (!book || typeof book.slug !== 'string') continue;
		const { slug } = book;

		if (Array.isArray(book.highlights) || Array.isArray(book.notes)) {
			const annotationsFile = new File(
				[
					JSON.stringify({
						version: 1,
						slug,
						exportedAt: payload.exportedAt ?? Date.now(),
						highlights: book.highlights ?? [],
						notes: book.notes ?? []
					})
				],
				'import.json',
				{ type: 'application/json' }
			);
			try {
				const r = await importAnnotations(slug, annotationsFile);
				summary.highlights += r.highlights;
				summary.notes += r.notes;
			} catch {
				/* malformed per-book payload — skip rather than aborting the whole import */
			}
		}

		if (Array.isArray(book.chatHistory)) {
			summary.chatTurns += importHistory(slug, book.chatHistory as ChatTurn[]);
		}
		if (Array.isArray(book.practiceSessions)) {
			summary.practiceSessions += importSessions(
				slug,
				book.practiceSessions as Parameters<typeof importSessions>[1]
			);
		}
		if (book.readingPosition && !getPosition(slug)) {
			savePosition(slug, (book.readingPosition as ReadingPosition).sectionId);
			summary.readingPositions++;
		}
		if (Array.isArray(book.visitedSections)) {
			for (const id of book.visitedSections) markSectionVisited(slug, id);
		}
	}

	if (payload.modelSettings && !loadSettings()) {
		saveSettings(payload.modelSettings);
		summary.settingsApplied = true;
	}

	return summary;
}
