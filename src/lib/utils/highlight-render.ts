/**
 * Re-apply persisted user highlights to a block's html (SPEC.md §7
 * "highlight rendering must survive re-render and not corrupt block HTML —
 * reuse the tag-aware tokenizer approach from
 * `src/lib/utils/glossary-highlight.ts`").
 *
 * Highlights are stored as plain-text `[start, end)` character offsets (see
 * `$lib/utils/text-offset`), captured from the *rendered* DOM's
 * `textContent` — which decodes HTML entities. To wrap the right
 * *source* characters in `<mark>` tags, this walks the same tag/text token
 * stream `highlightGlossaryTerms` uses, but additionally splits each text
 * token into "one visible character" pieces (a decoded entity like `&amp;`
 * is one visible character spanning five source characters; everything else
 * is 1:1) so plain-text offsets and source-string positions never drift
 * apart. The whole thing runs on the server during prerendering too (no
 * DOMParser there), so it has to be string-only — no live DOM.
 *
 * Ranges may overlap (multiple highlights over the same span); overlapping
 * regions render as nested `<mark>` elements rather than being merged, so
 * each highlight keeps its own `data-highlight-id` and can be removed
 * independently.
 */

export interface MarkRange {
	id: string;
	start: number;
	end: number;
}

const ENTITY_RE = /&(?:#[0-9]+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g;

interface Piece {
	raw: string;
	/** Visible/plain-text length this piece contributes (1 for an entity, `raw.length` otherwise). */
	len: number;
}

/** Split a text token into entity vs. plain-run pieces so each piece's `len` matches how many
 * *decoded* characters it represents. */
function splitEntities(text: string): Piece[] {
	const pieces: Piece[] = [];
	let last = 0;
	ENTITY_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = ENTITY_RE.exec(text)) !== null) {
		if (m.index > last) pieces.push({ raw: text.slice(last, m.index), len: m.index - last });
		pieces.push({ raw: m[0], len: 1 });
		last = m.index + m[0].length;
	}
	if (last < text.length) pieces.push({ raw: text.slice(last), len: text.length - last });
	return pieces;
}

export function applyHighlights(html: string, ranges: MarkRange[]): string {
	const valid = ranges.filter((r) => r.end > r.start);
	if (valid.length === 0) return html;

	const breakpoints = [...new Set(valid.flatMap((r) => [r.start, r.end]))].sort((a, b) => a - b);
	const opensAt = new Map<number, string[]>();
	const closesAt = new Map<number, string[]>();
	const pushInto = (map: Map<number, string[]>, key: number, id: string) => {
		const list = map.get(key);
		if (list) list.push(id);
		else map.set(key, [id]);
	};
	for (const r of valid) {
		pushInto(opensAt, r.start, r.id);
		pushInto(closesAt, r.end, r.id);
	}

	const tokens = html.match(/<[^>]*>|[^<]+/g) ?? [];
	let plainPos = 0;
	const active: string[] = [];
	const out: string[] = [];

	// Buffer consecutive raw text so a run of characters that never crosses a highlight boundary
	// (or a tag) becomes exactly one `<mark>`, not one per internal piece/entity split.
	let buffer = '';

	function flush(): void {
		if (buffer === '') return;
		let wrapped = buffer;
		for (let i = active.length - 1; i >= 0; i--) {
			wrapped = `<mark class="user-highlight" data-highlight-id="${active[i]}">${wrapped}</mark>`;
		}
		out.push(wrapped);
		buffer = '';
	}

	function applyBoundary(pos: number): void {
		const closes = closesAt.get(pos) ?? [];
		const opens = opensAt.get(pos) ?? [];
		if (closes.length === 0 && opens.length === 0) return;
		flush(); // active is about to change — close out the run wrapped with the old state first
		for (const id of closes) {
			const i = active.indexOf(id);
			if (i !== -1) active.splice(i, 1);
		}
		for (const id of opens) {
			if (!active.includes(id)) active.push(id);
		}
	}

	// A highlight starting at the very first character needs its boundary applied before any
	// content is emitted.
	applyBoundary(0);

	for (const token of tokens) {
		if (token.startsWith('<')) {
			flush(); // tags are never wrapped and never merge into a text buffer
			out.push(token);
			continue;
		}
		for (const piece of splitEntities(token)) {
			if (piece.len === 1 && piece.raw.length !== 1) {
				// An entity reference (e.g. "&amp;") — atomic, can't be split mid-reference.
				buffer += piece.raw;
				plainPos += 1;
				applyBoundary(plainPos);
				continue;
			}
			// Plain run — 1:1 with source chars; split only at breakpoints that fall inside it.
			let cursor = 0;
			while (cursor < piece.raw.length) {
				const absPos = plainPos + cursor;
				let chunkLen = piece.raw.length - cursor;
				for (const bp of breakpoints) {
					if (bp > absPos && bp - absPos < chunkLen) chunkLen = bp - absPos;
				}
				buffer += piece.raw.slice(cursor, cursor + chunkLen);
				cursor += chunkLen;
				applyBoundary(plainPos + cursor);
			}
			plainPos += piece.len;
		}
	}
	flush();

	return out.join('');
}
