<script lang="ts">
	import type { Block } from '$lib/data/book';
	import type { ConceptNode } from '$lib/data/graph';
	import { rewriteMediaSrc } from '$lib/utils/media';
	import { highlightGlossaryTerms } from '$lib/utils/glossary-highlight';
	import { applyHighlights, type MarkRange } from '$lib/utils/highlight-render';

	let {
		block,
		mediaBase,
		breadcrumb = [],
		hidden = false,
		glossaryConcepts = [],
		userHighlights = [],
		hasBlockNote = false,
		onConceptActivate,
		onHighlightActivate,
		onBlockNoteActivate
	}: {
		block: Block;
		mediaBase: string;
		breadcrumb?: string[];
		hidden?: boolean;
		/** Concepts defined in this block's section — first occurrence of each is highlighted
		 * (SPEC.md §4). Pass `[]` (the default) to skip highlighting entirely, e.g. when no graph
		 * is loaded for this book. */
		glossaryConcepts?: ConceptNode[];
		/** This block's persisted user highlights (SPEC.md §7), as plain-text offset ranges — see
		 * `$lib/utils/highlight-render`. Pass `[]` (the default) where annotation features aren't
		 * wired up (e.g. outside the reader). */
		userHighlights?: MarkRange[];
		/** True when a whole-block note exists for this block — shows the note affordance as "has a
		 * note" rather than "add a note". */
		hasBlockNote?: boolean;
		/** Called with (conceptId, the clicked/activated element) when a highlighted term is
		 * clicked or activated via keyboard. */
		onConceptActivate?: (conceptId: string, target: HTMLElement) => void;
		/** Called with (highlightId, the clicked/activated element) when a user highlight mark is
		 * clicked or activated via keyboard. */
		onHighlightActivate?: (highlightId: string, target: HTMLElement) => void;
		/** Called with the clicked button element when the block-level "add/view note" affordance is
		 * activated. Omit to hide it entirely (e.g. outside the reader, or when annotations aren't
		 * available). */
		onBlockNoteActivate?: (target: HTMLElement) => void;
	} = $props();

	let html = $derived(
		applyHighlights(
			highlightGlossaryTerms(rewriteMediaSrc(block.html, mediaBase), glossaryConcepts),
			userHighlights
		)
	);

	function conceptIdFromEvent(event: Event): { id: string; el: HTMLElement } | null {
		const target = event.target as HTMLElement | null;
		const mark = target?.closest<HTMLElement>('.concept-term');
		if (!mark) return null;
		const id = mark.dataset.conceptId;
		return id ? { id, el: mark } : null;
	}

	function highlightIdFromEvent(event: Event): { id: string; el: HTMLElement } | null {
		const target = event.target as HTMLElement | null;
		const mark = target?.closest<HTMLElement>('.user-highlight');
		if (!mark) return null;
		const id = mark.dataset.highlightId;
		return id ? { id, el: mark } : null;
	}

	function handleClick(event: MouseEvent) {
		// A concept term always wins over an overlapping user highlight (the term is the more
		// specific, inner target when both marks wrap the same text) — see the "closest ancestor"
		// note in the highlight-render module doc.
		const concept = conceptIdFromEvent(event);
		if (concept) {
			onConceptActivate?.(concept.id, concept.el);
			return;
		}
		const highlight = highlightIdFromEvent(event);
		if (highlight) onHighlightActivate?.(highlight.id, highlight.el);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		const concept = conceptIdFromEvent(event);
		if (concept) {
			event.preventDefault();
			onConceptActivate?.(concept.id, concept.el);
			return;
		}
		const highlight = highlightIdFromEvent(event);
		if (highlight) {
			event.preventDefault();
			onHighlightActivate?.(highlight.id, highlight.el);
		}
	}
</script>

{#if hidden}
	<!-- Content is already shown by the section header (e.g. objectives[]); keep the anchor
	     addressable for deep links and future citations without showing it twice. -->
	<div id={block.anchor} class="block block-anchor-only" data-anchor={block.anchor}></div>
{:else}
	{#if breadcrumb.length > 0}
		<p class="block-trail" aria-hidden="true">{breadcrumb.join(' › ')}</p>
	{/if}
	<div class="block-wrap">
		<!-- Click/keydown here are pure event delegation for `.concept-term`/`.user-highlight` marks
		     inside, which are already independently focusable/keyboard-operable (tabindex,
		     role="button"). The div itself isn't meant to read as interactive — it's the book's prose. -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			id={block.anchor}
			class="block"
			data-anchor={block.anchor}
			onclick={handleClick}
			onkeydown={handleKeydown}
		>
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			{@html html}
		</div>
		{#if onBlockNoteActivate}
			<button
				type="button"
				class="block-note-btn"
				class:has-note={hasBlockNote}
				onclick={(e) => onBlockNoteActivate?.(e.currentTarget as HTMLElement)}
				aria-label={hasBlockNote ? 'View note on this paragraph' : 'Add a note to this paragraph'}
				title={hasBlockNote ? 'View note' : 'Add note'}
			>
				{hasBlockNote ? '🗨' : '+ note'}
			</button>
		{/if}
	</div>
{/if}
