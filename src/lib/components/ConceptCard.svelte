<script lang="ts">
	import type { GraphIndex } from '$lib/data/graph';
	import { relatedConcepts, sectionsForConcept } from '$lib/data/graph';

	let {
		graph,
		conceptId,
		anchorRect = null,
		currentSectionId = null,
		onClose,
		onSelectConcept
	}: {
		graph: GraphIndex;
		conceptId: string;
		/** Bounding rect of the element that triggered the card (a clicked glossary term), used to
		 * position it nearby. `null` centers it (e.g. opened some other way in the future). */
		anchorRect?: DOMRect | null;
		/** Suppress the "defined in" link when it would just point at the section already open. */
		currentSectionId?: string | null;
		onClose: () => void;
		/** Called instead of navigating when a related concept is clicked — lets the caller keep the
		 * card open and just swap which concept it shows. */
		onSelectConcept?: (id: string) => void;
	} = $props();

	let concept = $derived(graph.conceptsById.get(conceptId));
	let related = $derived(concept ? relatedConcepts(graph, concept.id) : []);
	let definedSection = $derived(concept ? graph.sectionByModule.get(concept.defined_in) : undefined);
	let mentionSections = $derived(concept ? sectionsForConcept(graph, concept.id).mentions : []);

	let cardEl: HTMLDivElement | undefined = $state();
	let style = $derived(computeStyle(anchorRect));

	function computeStyle(rect: DOMRect | null): string {
		if (!rect || typeof window === 'undefined') return '';
		// `.concept-card` is `position: fixed`, i.e. positioned relative to the viewport — `rect`
		// (from `getBoundingClientRect()`) is already viewport-relative, so no `scrollY` offset
		// belongs here (that would be correct for `position: absolute` in the document, not `fixed`).
		const maxLeft = window.innerWidth - 336; // card width (320) + margin
		const left = Math.max(8, Math.min(rect.left, maxLeft));
		const maxTop = window.innerHeight - 60; // keep at least a sliver on-screen
		const top = Math.max(8, Math.min(rect.bottom + 8, maxTop));
		return `top:${top}px; left:${left}px;`;
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onClose();
	}

	function handleWindowPointerdown(event: PointerEvent) {
		if (cardEl && !cardEl.contains(event.target as Node)) onClose();
	}

	$effect(() => {
		cardEl?.querySelector<HTMLElement>('.concept-card-close')?.focus();
	});
</script>

<svelte:window onkeydown={handleWindowKeydown} onpointerdown={handleWindowPointerdown} />

{#if concept}
	<div
		bind:this={cardEl}
		class="concept-card"
		class:concept-card-anchored={!!anchorRect}
		{style}
		role="dialog"
		aria-label="Concept: {concept.term}"
	>
		<button type="button" class="concept-card-close" onclick={onClose} aria-label="Close">&times;</button>
		<p class="concept-card-term">{concept.term}</p>
		<p class="concept-card-definition">{concept.definition}</p>

		{#if definedSection && definedSection.module !== currentSectionId}
			<p class="concept-card-row">
				Defined in <a href="/read/{definedSection.module}">
					{definedSection.number ? `${definedSection.number} ` : ''}{definedSection.title}
				</a>
			</p>
		{/if}

		{#if related.length > 0}
			<div class="concept-card-related">
				<span class="concept-card-label">Related concepts</span>
				<ul>
					{#each related as { concept: rc, edge } (rc.id + edge.type)}
						<li>
							<button
								type="button"
								class="concept-card-related-link"
								onclick={() => onSelectConcept?.(rc.id)}
							>
								{rc.term}
							</button>
							<span class="concept-card-edge-type">{edge.type}</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if mentionSections.length > 0}
			<p class="concept-card-row concept-card-mentions">
				Also mentioned in {mentionSections.length} other section{mentionSections.length === 1 ? '' : 's'}.
			</p>
		{/if}

		<a class="concept-card-map-link" href="/map?concept={encodeURIComponent(concept.id)}&view=neighborhood">
			View in concept map &rarr;
		</a>
		<a class="concept-card-map-link" href="/pathways?concept={encodeURIComponent(concept.id)}">
			Path to this concept &rarr;
		</a>
	</div>
{/if}
