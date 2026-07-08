<script lang="ts">
	/**
	 * Popover for an existing user highlight (SPEC.md §7) — opened by clicking/activating a
	 * `.user-highlight` mark in a `Block` (mirrors `ConceptCard`'s popover pattern and positioning
	 * logic for a highlighted glossary term). Shows the highlighted text, any attached note (with
	 * inline edit), and remove/add-note actions.
	 */
	import type { Highlight, Note } from '$lib/stores/highlights';
	import { removeHighlight, addNote, updateNote, removeNote } from '$lib/stores/highlights';
	import { bookQuerySuffix } from '$lib/utils/book-link';

	let bookSuffix = $derived(bookQuerySuffix());

	let {
		slug,
		highlight,
		note = null,
		anchorRect = null,
		autoEdit = false,
		onClose
	}: {
		slug: string;
		highlight: Highlight;
		note?: Note | null;
		anchorRect?: DOMRect | null;
		/** Open straight into the note editor (the selection toolbar's "Add note" already created the
		 * highlight — this skips straight to writing the note that goes with it). */
		autoEdit?: boolean;
		onClose: () => void;
	} = $props();

	// `note`/`autoEdit` are only read once, at mount, to seed local editing state — intentional
	// (the caller wraps this component in `{#key highlight.id}`, so a new highlight/note always gets
	// a fresh instance rather than reusing one with stale `editing`/`draft`). svelte-check's
	// "state_referenced_locally" warning here is a known false positive for that reason.
	let editing = $state(autoEdit);
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

	function startEditing() {
		draft = note?.text ?? '';
		editing = true;
	}

	function saveNote() {
		const text = draft.trim();
		if (!text) {
			editing = false;
			return;
		}
		if (note) {
			updateNote(slug, note.id, text);
		} else {
			addNote(slug, {
				blockAnchor: highlight.anchor,
				highlightId: highlight.id,
				sectionId: highlight.sectionId,
				sectionTitle: highlight.sectionTitle,
				sectionNumber: highlight.sectionNumber,
				text
			});
		}
		editing = false;
	}

	function deleteNote() {
		if (note) removeNote(slug, note.id);
		editing = false;
	}

	function deleteHighlight() {
		removeHighlight(slug, highlight.id);
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
	aria-label="Highlight"
>
	<button type="button" class="concept-card-close" onclick={onClose} aria-label="Close">&times;</button>
	<p class="concept-card-label">Your highlight</p>
	<blockquote class="highlight-card-quote">&ldquo;{highlight.text}&rdquo;</blockquote>

	{#if editing}
		<textarea class="highlight-card-note-input" bind:value={draft} placeholder="Add a note…" rows="3"
		></textarea>
		<div class="highlight-card-actions">
			<button type="button" class="highlight-card-save" onclick={saveNote}>Save note</button>
			<button type="button" class="highlight-card-cancel" onclick={() => (editing = false)}>Cancel</button>
		</div>
	{:else if note}
		<p class="concept-card-label">Note</p>
		<p class="highlight-card-note-text">{note.text}</p>
		<div class="highlight-card-actions">
			<button type="button" class="highlight-card-save" onclick={startEditing}>Edit note</button>
			<button type="button" class="highlight-card-cancel" onclick={deleteNote}>Delete note</button>
		</div>
	{:else}
		<div class="highlight-card-actions">
			<button type="button" class="highlight-card-save" onclick={startEditing}>Add note</button>
		</div>
	{/if}

	<div class="highlight-card-actions">
		<button type="button" class="highlight-card-cancel" onclick={deleteHighlight}>Remove highlight</button>
		<a class="concept-card-map-link" href="/notebook{bookSuffix}">Open notebook &rarr;</a>
	</div>
</div>
