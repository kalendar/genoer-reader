import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_BOOK_SLUG } from '$lib/data/book';
import type { EntryGenerator } from './$types';

// Prerendering entry list for the static build (SPEC.md §2: the whole app must build to a fully
// static site). Reads book.json straight off disk at build time — cheap and avoids depending on
// the dev/preview server being up yet. Only covers the bundled default book; a future loader
// milestone that lets users open arbitrary books at runtime doesn't need build-time entries for
// those, since they're never prerenderable anyway.
export const entries: EntryGenerator = () => {
	const bookPath = path.join(process.cwd(), 'static', 'books', DEFAULT_BOOK_SLUG, 'book.json');
	if (!fs.existsSync(bookPath)) {
		return [];
	}
	const book = JSON.parse(fs.readFileSync(bookPath, 'utf-8')) as { sections: { id: string }[] };
	return book.sections.map((section) => ({ sectionId: section.id }));
};
