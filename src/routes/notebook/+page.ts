import { resolveBookParam, getRegisteredSourceByUrl, readBookParam } from '$lib/data/book-source';
import { DEFAULT_BOOK_SLUG } from '$lib/data/book';
import type { PageLoad } from './$types';

// A static page — highlights/notes live entirely in localStorage and carry their own section
// titles/numbers at creation time (see $lib/stores/highlights.ts), so there's no book/graph fetch
// to do here beyond knowing which book slug's storage bucket to read. A `?book=` param (SPEC.md §8)
// is resolved from the registry/URL string alone — no network/IndexedDB round trip needed for a
// slug lookup, so this stays synchronous-cheap even for the bundled default.
export const prerender = true;

export const load: PageLoad = async ({ url }) => {
	const ref = resolveBookParam(readBookParam(url), DEFAULT_BOOK_SLUG);
	let slug = ref.kind === 'url' ? ref.slug : ref.slug;
	if (ref.kind === 'url' && !slug) {
		// A literal `?book=<url>` we haven't fetched yet on this page — fall back to a registry
		// reverse-lookup (if some other route already loaded and registered it this session/browser)
		// rather than a network round trip just to read book.json's declared slug.
		slug = getRegisteredSourceByUrl(ref.url)?.slug ?? DEFAULT_BOOK_SLUG;
	}
	return { slug: slug ?? DEFAULT_BOOK_SLUG };
};
