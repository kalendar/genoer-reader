<script lang="ts">
	/**
	 * Reader selection toolbar (SPEC.md §4 "Selection toolbar" / §7
	 * "Explain-selected-text" + "Highlights & notes"): appears near a text
	 * selection made inside the section content and offers Explain this /
	 * Simplify this / Give me an example / Highlight / Add note.
	 *
	 * Listens for `selectionchange` (debounced via the browser's own event
	 * cadence) rather than only `mouseup`, so keyboard-driven selection
	 * (Shift+arrows) shows the toolbar too. Selections outside `containerSelector`
	 * (e.g. the sidebar, the section header) are ignored, and this coexists with
	 * `Block.svelte`'s click-delegated glossary-term/highlight popovers because
	 * a *collapsed* click never satisfies `currentBlockSelection`'s
	 * non-collapsed check.
	 */
	import { goto } from '$app/navigation';
	import type { Section } from '$lib/data/book';
	import { currentBlockSelection } from '$lib/utils/text-offset';
	import { addHighlight, addNote } from '$lib/stores/highlights';
	import { setSeededContext, type SeedInstruction } from '$lib/stores/chat-seed';

	let {
		slug,
		section,
		containerSelector = '.section-content',
		onNoteRequest
	}: {
		slug: string;
		section: Pick<Section, 'id' | 'title' | 'number' | 'blocks'>;
		containerSelector?: string;
		/** Called after a highlight is created from a selection, with the new highlight id, so the
		 * page can open the note editor bound to it. */
		onNoteRequest?: (highlightId: string, rect: DOMRect) => void;
	} = $props();

	let visible = $state(false);
	let rect = $state<DOMRect | null>(null);
	let current: ReturnType<typeof currentBlockSelection> = $state(null);

	function blockData(anchor: string) {
		return section.blocks.find((b) => b.anchor === anchor);
	}

	function handleSelectionChange() {
		const container = document.querySelector(containerSelector);
		const selection = window.getSelection();
		if (!container || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
			visible = false;
			current = null;
			return;
		}
		const range = selection.getRangeAt(0);
		if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
			visible = false;
			current = null;
			return;
		}
		const hit = currentBlockSelection('[data-anchor]');
		if (!hit || !blockData(hit.anchor)) {
			visible = false;
			current = null;
			return;
		}
		current = hit;
		rect = range.getBoundingClientRect();
		visible = rect.width > 0 || rect.height > 0;
	}

	function trailFor(anchor: string): string[] {
		const block = blockData(anchor);
		if (!block) return [];
		return block.trail.length > 0 && block.trail[block.trail.length - 1] === block.heading
			? block.trail.slice(0, -1)
			: block.trail;
	}

	function seedAndGoToChat(instruction: SeedInstruction) {
		if (!current) return;
		const block = blockData(current.anchor);
		if (!block) return;
		setSeededContext({
			instruction,
			selectionText: current.text,
			blockText: block.text,
			blockAnchor: block.anchor,
			trail: trailFor(current.anchor),
			sectionId: section.id,
			sectionTitle: section.title,
			sectionNumber: section.number
		});
		clearSelectionAndHide();
		goto('/chat');
	}

	function createHighlight() {
		if (!current) return;
		const h = addHighlight(slug, {
			anchor: current.anchor,
			sectionId: section.id,
			sectionTitle: section.title,
			sectionNumber: section.number,
			start: current.start,
			end: current.end,
			text: current.text
		});
		clearSelectionAndHide();
		return h;
	}

	function handleHighlight() {
		createHighlight();
	}

	function handleAddNote() {
		if (!current || !rect) return;
		const savedRect = rect;
		const h = createHighlight();
		if (h) onNoteRequest?.(h.id, savedRect);
	}

	function clearSelectionAndHide() {
		window.getSelection()?.removeAllRanges();
		visible = false;
		current = null;
	}

	let style = $derived(computeStyle(rect));

	function computeStyle(r: DOMRect | null): string {
		if (!r || typeof window === 'undefined') return '';
		const width = 300; // approximate toolbar width for clamping
		const left = Math.max(8, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 8));
		const top = Math.max(8, r.top - 44);
		return `top:${top}px; left:${left}px;`;
	}
</script>

<svelte:document onselectionchange={handleSelectionChange} />

{#if visible && current}
	<div class="selection-toolbar" {style} role="toolbar" aria-label="Selection actions">
		<button type="button" onclick={() => seedAndGoToChat('explain')}>Explain this</button>
		<button type="button" onclick={() => seedAndGoToChat('simplify')}>Simplify this</button>
		<button type="button" onclick={() => seedAndGoToChat('example')}>Give me an example</button>
		<span class="selection-toolbar-sep" aria-hidden="true"></span>
		<button type="button" onclick={handleHighlight}>Highlight</button>
		<button type="button" onclick={handleAddNote}>Add note</button>
	</div>
{/if}

<style>
	.selection-toolbar {
		position: fixed;
		z-index: 55;
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem;
		background: var(--color-bg-raised);
		border: 1px solid var(--color-border);
		border-radius: 0.4rem;
		box-shadow: 0 0.4rem 1rem rgb(0 0 0 / 25%);
		padding: 0.3rem;
		font-family: var(--font-ui);
	}

	.selection-toolbar button {
		background: none;
		border: none;
		border-radius: 0.25rem;
		padding: 0.35rem 0.55rem;
		cursor: pointer;
		color: var(--color-text);
		font-size: 0.8rem;
		white-space: nowrap;
	}

	.selection-toolbar button:hover,
	.selection-toolbar button:focus-visible {
		background: var(--color-bg);
		color: var(--color-accent);
		outline: none;
	}

	.selection-toolbar-sep {
		width: 1px;
		margin: 0.2rem 0.1rem;
		background: var(--color-border);
	}
</style>
