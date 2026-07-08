import type { ConceptNode } from '$lib/data/graph';

/**
 * Wrap the first occurrence (per block) of each given concept's term in a block's HTML with a
 * `<mark class="concept-term" data-concept-id="...">` span, so the reader can click/focus it to
 * open a concept card (SPEC.md §4 "Concept awareness").
 *
 * The whole `/read` subtree is prerendered (SPEC.md §2/§13), so this has to run correctly during
 * SSR in Node — where `DOMParser` doesn't exist — not just in the browser. Rather than pull in an
 * HTML-parsing dependency, this tokenizes the (already-cleaned, converter-produced) HTML into tag
 * tokens and text tokens with a single regex pass and only runs term-matching against text tokens,
 * tracking a depth counter for `<code>`/`<a>` so matches never land inside either (per this
 * milestone's brief) or inside a tag's own markup/attributes (which are never text tokens to begin
 * with, so they're structurally protected).
 */
export function highlightGlossaryTerms(html: string, concepts: ConceptNode[]): string {
	if (concepts.length === 0) return html;

	// Longest term first so e.g. "entrepreneurial venture" wins over "entrepreneur" at a shared
	// start position (JS regex alternation tries branches in order and takes the first match).
	const byLength = [...concepts].sort((a, b) => b.term.length - a.term.length);
	const pattern = new RegExp(
		`(?<![\\w])(${byLength.map((c) => escapeRegExp(c.term)).join('|')})(?![\\w])`,
		'gi'
	);
	const termToConcept = new Map(byLength.map((c) => [c.term.toLowerCase(), c]));

	const tokens = html.match(/<[^>]*>|[^<]+/g) ?? [];
	const highlighted = new Set<string>();
	let skipDepth = 0;

	const out = tokens.map((token) => {
		if (token.startsWith('<')) {
			const tagMatch = /^<\s*(\/?)\s*(code|a)\b/i.exec(token);
			if (tagMatch) {
				const isClosing = tagMatch[1] === '/';
				const selfClosing = /\/>\s*$/.test(token);
				if (isClosing) skipDepth = Math.max(0, skipDepth - 1);
				else if (!selfClosing) skipDepth += 1;
			}
			return token;
		}
		if (skipDepth > 0 || highlighted.size >= concepts.length) return token;
		return token.replace(pattern, (match) => {
			const concept = termToConcept.get(match.toLowerCase());
			if (!concept || highlighted.has(concept.id)) return match;
			highlighted.add(concept.id);
			return `<mark class="concept-term" data-concept-id="${concept.id}" tabindex="0" role="button" aria-haspopup="dialog">${match}</mark>`;
		});
	});

	return out.join('');
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
