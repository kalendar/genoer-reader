/**
 * Turn an assistant answer that cites passages by anchor (e.g. "[m71114-b4]")
 * into renderable segments (SPEC.md §5 "citations render as clickable
 * references"). Pure and testable.
 *
 * The model is prompted to cite by passage anchor; we display the citation as a
 * compact "[n]" that deep-links to `/read/<sectionId>#<anchor>`.
 */
import { base } from '$app/paths';
import type { Passage } from '$lib/retrieval';

export type Segment =
	| { type: 'text'; text: string }
	| { type: 'cite'; anchor: string; index: number; sectionId: string; href: string };

const CITE_RE = /\[([A-Za-z0-9][\w.-]*)\]/g;

export function parseCitations(text: string, passages: Passage[]): Segment[] {
	const byAnchor = new Map(passages.map((p) => [p.anchor, p]));
	const segments: Segment[] = [];
	let last = 0;
	let m: RegExpExecArray | null;
	CITE_RE.lastIndex = 0;
	while ((m = CITE_RE.exec(text)) !== null) {
		const anchor = m[1];
		const passage = byAnchor.get(anchor);
		if (!passage) continue; // not a known passage id — leave as literal text
		if (m.index > last) {
			segments.push({ type: 'text', text: text.slice(last, m.index) });
		}
		segments.push({
			type: 'cite',
			anchor,
			index: passage.index,
			sectionId: passage.sectionId,
			href: `${base}/read/${passage.sectionId}#${anchor}`
		});
		last = m.index + m[0].length;
	}
	if (last < text.length) {
		segments.push({ type: 'text', text: text.slice(last) });
	}
	return segments;
}
