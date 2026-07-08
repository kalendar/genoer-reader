/**
 * Highlights & notes (SPEC.md §7 "Highlights & notes").
 *
 * Highlights anchor to `(block anchor, start offset, end offset)` — offsets
 * are plain-text character offsets into the *rendered* block content (see
 * `$lib/utils/text-offset` for how the reader captures them from a
 * `Selection`, and `$lib/utils/highlight-render` for how they're re-applied
 * to a block's html on every render). Notes attach either to a highlight
 * (`highlightId` set) or to a whole block (`highlightId: null`).
 *
 * localStorage only, keyed by book slug (SPEC.md §8), exposed as Svelte
 * stores (rather than the plain load/save function pairs `$lib/stores/chat.ts`
 * and friends use) because highlights are read and written from several
 * independent places at once — the reader's blocks, the selection toolbar,
 * the highlight popover, and the notebook view — and all of them need to see
 * each other's writes reactively without prop-drilling.
 *
 * Export/import as a single JSON file (SPEC.md §7 — this is *Retain*,
 * demonstrated: the user's annotation layer is portable independent of the
 * app).
 */
import { writable, get } from 'svelte/store';

export interface Highlight {
	id: string;
	anchor: string;
	sectionId: string;
	sectionTitle: string;
	sectionNumber: string | null;
	/** Plain-text offsets into the block's rendered content. */
	start: number;
	end: number;
	/** The highlighted text itself, captured at creation time (for the notebook view and export —
	 * survives even if the book's content later changes). */
	text: string;
	createdAt: number;
}

export interface Note {
	id: string;
	blockAnchor: string;
	/** Set when this note is attached to a highlight; `null` for a whole-block note. */
	highlightId: string | null;
	sectionId: string;
	sectionTitle: string;
	sectionNumber: string | null;
	text: string;
	createdAt: number;
	updatedAt: number;
}

interface AnnotationsExport {
	version: 1;
	slug: string;
	exportedAt: number;
	highlights: Highlight[];
	notes: Note[];
}

const HIGHLIGHT_PREFIX = 'genoer:highlights:';
const NOTE_PREFIX = 'genoer:notes:';

function storageAvailable(): boolean {
	return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readList<T>(key: string): T[] {
	if (!storageAvailable()) return [];
	try {
		const raw = window.localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T[]) : [];
	} catch {
		return [];
	}
}

function writeList<T>(key: string, list: T[]): void {
	if (!storageAvailable()) return;
	try {
		window.localStorage.setItem(key, JSON.stringify(list));
	} catch {
		/* quota / private mode — non-fatal */
	}
}

export const highlights = writable<Highlight[]>([]);
export const notes = writable<Note[]>([]);

let loadedSlug: string | null = null;

/** Load a book's highlights/notes into the reactive stores. Idempotent per slug — cheap to call
 * from every route/component that touches annotations (mirrors `setCurrentBook`'s role). */
export function initAnnotations(slug: string): void {
	if (loadedSlug === slug) return;
	loadedSlug = slug;
	highlights.set(readList<Highlight>(HIGHLIGHT_PREFIX + slug));
	notes.set(readList<Note>(NOTE_PREFIX + slug));
}

function newId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function addHighlight(
	slug: string,
	h: Omit<Highlight, 'id' | 'createdAt'>
): Highlight {
	initAnnotations(slug);
	const highlight: Highlight = { ...h, id: newId(), createdAt: Date.now() };
	const next = [...get(highlights), highlight];
	highlights.set(next);
	writeList(HIGHLIGHT_PREFIX + slug, next);
	return highlight;
}

/** Removes a highlight and cascades to any note attached to it (a note with no highlight to attach
 * to would be orphaned and confusing in the notebook view). */
export function removeHighlight(slug: string, id: string): void {
	initAnnotations(slug);
	const nextHighlights = get(highlights).filter((h) => h.id !== id);
	highlights.set(nextHighlights);
	writeList(HIGHLIGHT_PREFIX + slug, nextHighlights);
	const nextNotes = get(notes).filter((n) => n.highlightId !== id);
	if (nextNotes.length !== get(notes).length) {
		notes.set(nextNotes);
		writeList(NOTE_PREFIX + slug, nextNotes);
	}
}

export function addNote(slug: string, n: Omit<Note, 'id' | 'createdAt' | 'updatedAt'>): Note {
	initAnnotations(slug);
	const now = Date.now();
	const note: Note = { ...n, id: newId(), createdAt: now, updatedAt: now };
	const next = [...get(notes), note];
	notes.set(next);
	writeList(NOTE_PREFIX + slug, next);
	return note;
}

export function updateNote(slug: string, id: string, text: string): void {
	initAnnotations(slug);
	const next = get(notes).map((n) => (n.id === id ? { ...n, text, updatedAt: Date.now() } : n));
	notes.set(next);
	writeList(NOTE_PREFIX + slug, next);
}

export function removeNote(slug: string, id: string): void {
	initAnnotations(slug);
	const next = get(notes).filter((n) => n.id !== id);
	notes.set(next);
	writeList(NOTE_PREFIX + slug, next);
}

export function clearAnnotations(slug: string): void {
	initAnnotations(slug);
	highlights.set([]);
	notes.set([]);
	writeList(HIGHLIGHT_PREFIX + slug, []);
	writeList(NOTE_PREFIX + slug, []);
}

/** Download everything as a single JSON file (SPEC.md §7 — demonstrates Retain). */
export function exportAnnotations(slug: string): void {
	if (typeof document === 'undefined') return;
	initAnnotations(slug);
	const payload: AnnotationsExport = {
		version: 1,
		slug,
		exportedAt: Date.now(),
		highlights: get(highlights),
		notes: get(notes)
	};
	const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `genoer-notebook-${slug}.json`;
	a.click();
	URL.revokeObjectURL(url);
}

function isHighlight(v: unknown): v is Highlight {
	const h = v as Partial<Highlight> | null;
	return (
		!!h &&
		typeof h.id === 'string' &&
		typeof h.anchor === 'string' &&
		typeof h.sectionId === 'string' &&
		typeof h.start === 'number' &&
		typeof h.end === 'number' &&
		typeof h.text === 'string'
	);
}

function isNote(v: unknown): v is Note {
	const n = v as Partial<Note> | null;
	return (
		!!n &&
		typeof n.id === 'string' &&
		typeof n.blockAnchor === 'string' &&
		typeof n.sectionId === 'string' &&
		typeof n.text === 'string'
	);
}

/**
 * Import a previously exported JSON file, merging by id (upsert) into the current slug's
 * annotations — non-destructive, so importing never silently drops existing highlights/notes.
 * Throws a human-readable error on malformed input rather than failing silently.
 */
export async function importAnnotations(slug: string, file: File): Promise<{ highlights: number; notes: number }> {
	initAnnotations(slug);
	const text = await file.text();
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error('That file is not valid JSON.');
	}
	const payload = data as Partial<AnnotationsExport> | null;
	if (!payload || !Array.isArray(payload.highlights) || !Array.isArray(payload.notes)) {
		throw new Error('That file doesn’t look like a GenOER notebook export (expected "highlights" and "notes" arrays).');
	}
	const importedHighlights = payload.highlights.filter(isHighlight);
	const importedNotes = payload.notes.filter(isNote);

	const highlightMap = new Map(get(highlights).map((h) => [h.id, h]));
	for (const h of importedHighlights) highlightMap.set(h.id, h);
	const nextHighlights = [...highlightMap.values()];
	highlights.set(nextHighlights);
	writeList(HIGHLIGHT_PREFIX + slug, nextHighlights);

	const noteMap = new Map(get(notes).map((n) => [n.id, n]));
	for (const n of importedNotes) noteMap.set(n.id, n);
	const nextNotes = [...noteMap.values()];
	notes.set(nextNotes);
	writeList(NOTE_PREFIX + slug, nextNotes);

	return { highlights: importedHighlights.length, notes: importedNotes.length };
}
