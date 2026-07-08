import type { Book } from '$lib/data/book';

/** Plain-text attribution statement built from book metadata (SPEC.md §4, §9). */
export function buildAttributionText(book: Pick<Book, 'title' | 'publisher' | 'license' | 'license_url'>): string {
	return `"${book.title}" by ${book.publisher} is licensed under ${book.license} (${book.license_url}).`;
}

const RESTRICTIVE_TERMS = ['NC', 'ND', 'SA'];

/** License abbreviation codes present in a license string, e.g. ["BY", "NC", "SA"]. Used to flag
 * NonCommercial / ShareAlike / NoDerivatives terms prominently, per SPEC.md §4. */
export function licenseCodes(license: string): string[] {
	const upper = license.toUpperCase();
	const codes: string[] = [];
	if (upper.includes('ATTRIBUTION') || /\bBY\b/.test(upper)) codes.push('BY');
	if (upper.includes('NONCOMMERCIAL') || /\bNC\b/.test(upper)) codes.push('NC');
	if (upper.includes('NODERIV') || /\bND\b/.test(upper)) codes.push('ND');
	if (upper.includes('SHAREALIKE') || /\bSA\b/.test(upper)) codes.push('SA');
	return codes;
}

export function hasRestrictiveTerms(license: string): boolean {
	return licenseCodes(license).some((c) => RESTRICTIVE_TERMS.includes(c));
}
