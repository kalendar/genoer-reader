/**
 * IndexedDB-backed storage for locally loaded books (SPEC.md §8 "Local file
 * loading" — "processed entirely in-browser; persist via IndexedDB ... so
 * navigation works").
 *
 * Scope is deliberately small: a local load is `book.json` + optional
 * `graph.json`, stored as their raw JSON text keyed by the slug the user
 * (or the book itself) assigns at load time. Media is NOT persisted for
 * local loads (SPEC.md §8's local-loading bullet only lists book.json/
 * graph.json) — figures degrade to broken-image + alt text, same as any
 * other missing-media case. A page reload keeps working (the whole point of
 * IndexedDB here); re-dropping the same file re-saves over the same slug.
 *
 * No third-party IndexedDB wrapper — the surface needed here (get/put/delete/
 * list two small object stores) is a dozen lines of native IndexedDB, and
 * this module is also imported by nothing performance-sensitive.
 */

const DB_NAME = 'genoer-local-books';
const DB_VERSION = 1;
const STORE = 'books';

export interface LocalBookEntry {
	/** The app-wide book slug this local load is registered under (SPEC.md §8 per-book keying). */
	slug: string;
	bookJson: string;
	graphJson: string | null;
	/** Human-readable label for "where this came from" — the file name(s) picked/dropped. */
	sourceLabel: string;
	savedAt: number;
}

function idbAvailable(): boolean {
	return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE)) {
				db.createObjectStore(STORE, { keyPath: 'slug' });
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error ?? new Error('Failed to open local-book database'));
	});
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	const db = await openDb();
	try {
		return await new Promise<T>((resolve, reject) => {
			const tx = db.transaction(STORE, mode);
			const store = tx.objectStore(STORE);
			const req = fn(store);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
		});
	} finally {
		db.close();
	}
}

export async function putLocalBook(entry: LocalBookEntry): Promise<void> {
	if (!idbAvailable()) throw new Error('This browser does not support IndexedDB, so local books can\'t be saved.');
	await withStore('readwrite', (store) => store.put(entry));
}

export async function getLocalBook(slug: string): Promise<LocalBookEntry | null> {
	if (!idbAvailable()) return null;
	const result = await withStore<LocalBookEntry | undefined>('readonly', (store) => store.get(slug));
	return result ?? null;
}

export async function deleteLocalBook(slug: string): Promise<void> {
	if (!idbAvailable()) return;
	await withStore('readwrite', (store) => store.delete(slug));
}

export async function listLocalBooks(): Promise<LocalBookEntry[]> {
	if (!idbAvailable()) return [];
	const result = await withStore<LocalBookEntry[]>('readonly', (store) => store.getAll());
	return (result ?? []).sort((a, b) => b.savedAt - a.savedAt);
}
