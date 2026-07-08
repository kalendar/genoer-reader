<script lang="ts">
	/**
	 * Popover for a whole-block note (SPEC.md §7: "notes attach to a highlight or a whole block") —
	 * opened via a block's "+ note" affordance (`Block.svelte`'s `onBlockNoteActivate`). Mirrors
	 * `HighlightCard`'s note editing, minus anything highlight-specific.
	 */
	import type { Note } from '$lib/stores/highlights';
	import { addNote, updateNote, removeNote } from '$lib/stores/highlights';

	let {
		slug,
		blockAnchor,
		sectionId,
		sectionTitle,
		sectionNumber,
		note = null,
		anchorRect = null,
		onClose
	}: {
		slug: string;
		blockAnchor: string;
		sectionId: string;
		sectionTitle: string;
		sectionNumber: string | null;
		note?: Note | null;
		anchorRect?: DOMRect | null;
		onClose: () => void;
	} = $props();

	// `note` is only read once, at mount, to seed local editing state — intentional (the caller
	// wraps this component in `{#key activeNoteBlockAnchor}`, so a new block always gets a fresh
	// instance rather than reusing one with a stale `draft`). svelte-check's
	// "state_referenced_locally" warning here is a known false positive for that reason.
	let draft = $state(note?.text ?? '');

	let cardEl: HTMLDivElement | undefined = $state();
	let style = $derived(computeStyle(anchorRect));

	function computeStyle(rect: DOMRect | null): string {
		if (!rect || typeof window === 'undefined') return '';
		const maxLeft = window.innerWidth - 336;
		const left = Math.max(8, Math.min(rect.left, maxLeft));
		const maxTop = window.innerHeight - 60;
		const top = Math.max(8, Math.min(rect.bottom + 8, maxTop));
		return `top:${top}px; left:${left}px;`;
	}

	function save() {
		const text = draft.trim();
		if (!text) {
			if (note) removeNote(slug, note.id);
			onClose();
			return;
		}
		if (note) {
			updateNote(slug, note.id, text);
		} else {
			addNote(slug, { blockAnchor, highlightId: null, sectionId, sectionTitle, sectionNumber, text });
		}
		onClose();
	}

	function deleteAndClose() {
		if (note) removeNote(slug, note.id);
		onClose();
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onClose();
	}

	function handleWindowPointerdown(event: PointerEvent) {
		if (cardEl && !cardEl.contains(event.target as Node)) onClose();
	}
</script>

<svelte:window onkeydown={handleWindowKeydown} onpointerdown={handleWindowPointerdown} />

<div
	bind:this={cardEl}
	class="concept-card highlight-card"
	class:concept-card-anchored={!!anchorRect}
	{style}
	role="dialog"
	aria-label="Note on this paragraph"
>
	<button type="button" class="concept-card-close" onclick={onClose} aria-label="Close">&times;</button>
	<p class="concept-card-label">Note on this paragraph</p>
	<textarea class="highlight-card-note-input" bind:value={draft} placeholder="Write a note…" rows="4"
	></textarea>
	<div class="highlight-card-actions">
		<button type="button" class="highlight-card-save" onclick={save}>Save</button>
		{#if note}
			<button type="button" class="highlight-card-cancel" onclick={deleteAndClose}>Delete</button>
		{/if}
	</div>
</div>
