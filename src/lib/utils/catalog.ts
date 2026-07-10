/**
 * The hosted OpenStax corpus catalog (github.com/kalendar/genoer-openstax):
 * every OpenStax textbook as `book.json`, plus `graph.json` where the
 * knowledge-graph pipeline has been run. The homepage's table of contents is
 * driven by the corpus's own `index.json`, so newly added books — and books
 * that later gain a graph (`hasGraph`) — appear/promote without touching the
 * reader.
 */

export const CORPUS_URL = 'https://kalendar.github.io/genoer-openstax';

export interface CatalogBook {
	slug: string;
	title: string;
	publisher: string;
	license: string;
	license_url: string;
	sections: number;
	blocks: number;
	hasGraph: boolean;
}

export interface Catalog {
	name: string;
	description: string;
	generated: string;
	books: CatalogBook[];
}

/** Directory URL for one corpus book — the exact value the `?book=` loader takes. */
export function corpusBookDir(slug: string): string {
	return `${CORPUS_URL}/${slug}/`;
}

/** Fetch the corpus catalog. Throws on network/shape failure — the homepage
 * degrades to the bundled book plus a retry hint. */
export async function fetchCatalog(fetchImpl: typeof fetch = fetch): Promise<Catalog> {
	const res = await fetchImpl(`${CORPUS_URL}/index.json`);
	if (!res.ok) throw new Error(`catalog: HTTP ${res.status}`);
	const data = (await res.json()) as Catalog;
	if (!Array.isArray(data.books)) throw new Error('catalog: malformed index.json');
	return data;
}
