/**
 * DOM `Selection`/`Range` → plain-text character offset, for the reader's
 * highlight feature (SPEC.md §7 "Highlights anchor to (block anchor, start
 * offset, end offset)"). Browser-only (uses `document.createRange`) — never
 * called during prerendering, only from the selection toolbar's event
 * handlers.
 *
 * `Range.toString()` already concatenates the text content of everything the
 * range spans, decoding entities and skipping markup exactly the way
 * `Node.textContent` does — so a range from the block element's start to a
 * given (node, offset) point has a `.toString().length` equal to the plain-
 * text offset of that point. That's simpler and more robust than walking
 * text nodes by hand, and it's the same "plain text" the rendered
 * `<mark>`-wrapping in `$lib/utils/highlight-render` has to agree with.
 */

/** Plain-text offset of `(node, nodeOffset)` relative to the start of `container`. */
export function offsetWithinContainer(container: Node, node: Node, nodeOffset: number): number {
	const range = document.createRange();
	range.selectNodeContents(container);
	range.setEnd(node, nodeOffset);
	return range.toString().length;
}

/** Plain-text `[start, end)` offsets of `range` relative to `container`'s start (order-normalized —
 * a user can select backwards, so `range.startContainer` isn't always the earlier point). */
export function offsetsWithinContainer(container: Node, range: Range): { start: number; end: number } {
	const a = offsetWithinContainer(container, range.startContainer, range.startOffset);
	const b = offsetWithinContainer(container, range.endContainer, range.endOffset);
	return { start: Math.min(a, b), end: Math.max(a, b) };
}

/**
 * Find the nearest ancestor (or self) of `node` matching `selector`, treating a bare Text node by
 * walking up to its parent element first (`Node.parentElement`/`closest` isn't defined on Text).
 */
export function closestElement(node: Node, selector: string): HTMLElement | null {
	const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
	return el?.closest<HTMLElement>(selector) ?? null;
}

/**
 * The current window selection, clamped to a single block element (`[data-anchor]` by convention
 * — see `Block.svelte`). Returns `null` when there's no selection, it's collapsed, or it doesn't
 * start inside a block. A selection that runs past the end of its starting block is clamped to
 * that block's own text length — cross-block highlights aren't supported (SPEC.md §7 scopes
 * highlights to a single block anchor), so this fails safe rather than corrupting a neighbor.
 */
export function currentBlockSelection(
	blockSelector = '[data-anchor]'
): { blockEl: HTMLElement; anchor: string; start: number; end: number; text: string } | null {
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
	const range = sel.getRangeAt(0);
	const blockEl = closestElement(range.startContainer, blockSelector);
	if (!blockEl) return null;
	const anchor = blockEl.dataset.anchor;
	if (!anchor) return null;

	const blockTextLength = (blockEl.textContent ?? '').length;
	const { start, end } = offsetsWithinContainer(blockEl, range);
	const clampedEnd = Math.min(end, blockTextLength);
	if (clampedEnd <= start) return null;

	const text = (blockEl.textContent ?? '').slice(start, clampedEnd);
	return { blockEl, anchor, start, end: clampedEnd, text };
}
