#!/usr/bin/env node
/**
 * Downloads the bundled reference book's (gitignored) media files so a fresh
 * clone/fork can build a fully-illustrated site (README.md "Deploying"; this
 * is what the GitHub Actions Pages workflow runs before `npm run build`).
 *
 * Reads book-data/entrepreneurship/book.json, extracts every referenced
 * media filename the same way the app itself references media — figure
 * `img[src="media/<file>"]` inside block html, plus each section's
 * `figures[].src` metadata entry (SPEC.md §8 `Figure`) — and downloads any
 * that aren't already present in book-data/entrepreneurship/media/ from the
 * upstream osbooks-entrepreneurship repo on GitHub. Already-present files are
 * skipped (idempotent — safe to re-run, and cheap in CI once a repo's own
 * media/ is cached or committed).
 *
 * Plain Node >= 20, no dependencies (global fetch, fs/promises).
 */
import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BOOK_DIR = path.join(ROOT, 'book-data', 'entrepreneurship');
const BOOK_JSON = path.join(BOOK_DIR, 'book.json');
const MEDIA_DIR = path.join(BOOK_DIR, 'media');
const RAW_BASE = 'https://raw.githubusercontent.com/openstax/osbooks-entrepreneurship/main/media/';

const IMG_SRC_RE = /\ssrc="media\/([^"]+)"/g;

/** Every distinct media filename this book actually references — mirrors how the app itself
 * resolves media (see $lib/utils/media.ts's rewriteMediaSrc + $lib/data/book.ts's Figure type):
 * figure `img[src="media/<file>"]` inside block html, plus each section's `figures[].src`. */
function collectReferencedFilenames(book) {
	const files = new Set();
	for (const section of book.sections ?? []) {
		for (const figure of section.figures ?? []) {
			if (figure?.src) files.add(figure.src.split('/').pop());
		}
		for (const block of section.blocks ?? []) {
			const html = block?.html ?? '';
			IMG_SRC_RE.lastIndex = 0;
			let m;
			while ((m = IMG_SRC_RE.exec(html)) !== null) {
				files.add(m[1]);
			}
		}
	}
	return [...files].sort();
}

async function fileExists(p) {
	try {
		await access(p);
		return true;
	} catch {
		return false;
	}
}

async function downloadOne(filename) {
	const url = RAW_BASE + encodeURIComponent(filename);
	const res = await fetch(url);
	if (!res.ok) {
		return { filename, ok: false, status: res.status };
	}
	const buf = Buffer.from(await res.arrayBuffer());
	await writeFile(path.join(MEDIA_DIR, filename), buf);
	return { filename, ok: true };
}

async function main() {
	const raw = await readFile(BOOK_JSON, 'utf-8');
	const book = JSON.parse(raw);
	const referenced = collectReferencedFilenames(book);

	console.log(`fetch-media: ${referenced.length} distinct media files referenced by book.json`);

	await mkdir(MEDIA_DIR, { recursive: true });

	const toSkip = [];
	const toDownload = [];
	for (const filename of referenced) {
		if (await fileExists(path.join(MEDIA_DIR, filename))) {
			toSkip.push(filename);
		} else {
			toDownload.push(filename);
		}
	}

	console.log(`fetch-media: ${toSkip.length} already present, ${toDownload.length} to download`);

	const failures = [];
	// Modest concurrency — polite to the upstream CDN, still fast for ~217 files.
	const CONCURRENCY = 8;
	let cursor = 0;
	let downloaded = 0;
	async function worker() {
		while (cursor < toDownload.length) {
			const filename = toDownload[cursor++];
			const result = await downloadOne(filename);
			if (result.ok) {
				downloaded++;
			} else {
				failures.push(result);
				console.error(`fetch-media: FAILED ${filename} (HTTP ${result.status})`);
			}
		}
	}
	await Promise.all(Array.from({ length: Math.min(CONCURRENCY, toDownload.length) }, worker));

	console.log(
		`fetch-media: done — ${toSkip.length} skipped, ${downloaded} downloaded, ${failures.length} failed` +
			` (of ${referenced.length} total).`
	);

	if (failures.length > 0) {
		console.error('fetch-media: the following files failed to download:');
		for (const f of failures) console.error(`  - ${f.filename} (HTTP ${f.status})`);
		process.exitCode = 1;
	}
}

main().catch((err) => {
	console.error('fetch-media: fatal error', err);
	process.exitCode = 1;
});
