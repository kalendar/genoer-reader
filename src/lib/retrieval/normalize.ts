/**
 * Text normalization for concept matching (SPEC.md §5: "normalization (case,
 * plurals/stemming) and multi-word term detection"). Pure, no dependencies.
 */

/** Lowercase, strip punctuation to spaces, collapse whitespace. */
export function normalizeText(s: string): string {
	return s
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim()
		.replace(/\s+/g, ' ');
}

/**
 * A deliberately small, symmetric plural stemmer. Applied to BOTH the glossary
 * term and the question, so "entrepreneurs" ↔ "entrepreneur" and "businesses" ↔
 * "business" match without a heavyweight stemmer. Not linguistically perfect —
 * good enough for glossary lookup, and consistent on both sides.
 */
export function stemToken(t: string): string {
	if (t.length > 4 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
	if (t.length > 4 && t.endsWith('ses')) return t.slice(0, -2); // businesses→business, processes→process
	if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
	return t;
}

/** Normalize → split → stem. The canonical token form used everywhere in matching. */
export function tokenize(s: string): string[] {
	const norm = normalizeText(s);
	if (!norm) return [];
	return norm.split(' ').map(stemToken);
}
