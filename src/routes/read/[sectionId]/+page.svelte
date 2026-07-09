<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { mediaBase } from '$lib/data/book';
	import { conceptsBySection } from '$lib/data/graph';
	import { savePosition } from '$lib/stores/reading-position';
	import { getVisitedSections, markSectionVisited } from '$lib/stores/visited-sections';
	import { highlights, notes, initAnnotations } from '$lib/stores/highlights';
	import Block from '$lib/components/Block.svelte';
	import SectionNav from '$lib/components/SectionNav.svelte';
	import PrerequisitePanel from '$lib/components/PrerequisitePanel.svelte';
	import ConceptCard from '$lib/components/ConceptCard.svelte';
	import SelectionToolbar from '$lib/components/SelectionToolbar.svelte';
	import HighlightCard from '$lib/components/HighlightCard.svelte';
	import BlockNoteCard from '$lib/components/BlockNoteCard.svelte';
	import JsonViewer from '$lib/components/JsonViewer.svelte';
	import { prefersReducedMotion } from '$lib/utils/motion';
	import { bookQuerySuffix, bookAmpParam } from '$lib/utils/book-link';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let media = $derived(mediaBase(data.slug));
	let bookSuffix = $derived(bookQuerySuffix());
	let bookAmp = $derived(bookAmpParam());

	// Concepts this section defines (SPEC.md §4) — [] when the book has no graph, which both
	// PrerequisitePanel's caller-side guard and Block's highlighter treat as "nothing to do".
	let glossaryConcepts = $derived(data.graph ? conceptsBySection(data.graph, data.section.id) : []);

	let visitedSections = $state<Set<string>>(new Set());

	// Concept card popover state, shared across every Block in this section (event-delegated).
	let activeConceptId: string | null = $state(null);
	let activeAnchorRect: DOMRect | null = $state(null);

	// The element that opened whichever popover is currently active (SPEC.md §10 "focus management
	// in popovers ... focus returns") — restored on close so keyboard/screen-reader users land back
	// where they were, not at the top of the document.
	let popoverTrigger: HTMLElement | null = null;

	function openConceptCard(conceptId: string, target: HTMLElement) {
		closeAllPopovers();
		popoverTrigger = target;
		activeConceptId = conceptId;
		activeAnchorRect = target.getBoundingClientRect();
	}

	// Highlights & notes (SPEC.md §7) — the reactive store is initialised once per slug and read by
	// both the selection toolbar (writer) and every Block (reader), so a highlight created anywhere
	// shows up immediately without prop-drilling a callback chain.
	$effect(() => {
		initAnnotations(data.slug);
	});

	let sectionHighlights = $derived($highlights.filter((h) => h.sectionId === data.section.id));
	let sectionNotes = $derived($notes.filter((n) => n.sectionId === data.section.id));

	function highlightsFor(anchor: string) {
		return sectionHighlights.filter((h) => h.anchor === anchor).map((h) => ({ id: h.id, start: h.start, end: h.end }));
	}

	function blockNoteFor(anchor: string) {
		return sectionNotes.find((n) => n.highlightId === null && n.blockAnchor === anchor);
	}

	// Highlight popover state. `highlightAutoEdit` is set when the selection toolbar's "Add note"
	// already created the highlight and just wants the note editor open immediately (SPEC.md §7
	// "notes attach to a highlight or a whole block").
	let activeHighlightId: string | null = $state(null);
	let activeHighlightRect: DOMRect | null = $state(null);
	let highlightAutoEdit = $state(false);

	function openHighlightCard(highlightId: string, target: HTMLElement) {
		closeAllPopovers();
		popoverTrigger = target;
		activeHighlightId = highlightId;
		activeHighlightRect = target.getBoundingClientRect();
	}

	function openNoteForHighlight(highlightId: string, rect: DOMRect) {
		closeAllPopovers();
		// Opened from the selection toolbar (which vanishes once the selection clears), not a
		// persistent element — nothing meaningful to return focus to, so `popoverTrigger` stays null
		// and focus simply lands in the note editor that opens (still keyboard-reachable from there).
		activeHighlightId = highlightId;
		activeHighlightRect = rect;
		highlightAutoEdit = true;
	}

	// Whole-block note popover state (the block's own "+ note" affordance — never touches a highlight).
	let activeNoteBlockAnchor: string | null = $state(null);
	let activeNoteRect: DOMRect | null = $state(null);

	function openBlockNote(anchor: string, target: HTMLElement) {
		closeAllPopovers();
		popoverTrigger = target;
		activeNoteBlockAnchor = anchor;
		activeNoteRect = target.getBoundingClientRect();
	}

	function restoreFocus() {
		if (popoverTrigger && document.contains(popoverTrigger)) popoverTrigger.focus();
		popoverTrigger = null;
	}

	function closeAllPopovers() {
		activeConceptId = null;
		activeAnchorRect = null;
		activeHighlightId = null;
		activeHighlightRect = null;
		highlightAutoEdit = false;
		activeNoteBlockAnchor = null;
		activeNoteRect = null;
	}

	/** Same as `closeAllPopovers`, but also restores focus — used by the popovers' own `onClose`
	 * (an explicit user dismissal), not by the "close whichever else is open" call inside `open*`
	 * above (which is about to focus something else anyway). */
	function closeAllPopoversAndRestoreFocus() {
		closeAllPopovers();
		restoreFocus();
	}

	function closeConceptCard() {
		activeConceptId = null;
		activeAnchorRect = null;
		restoreFocus();
	}

	// A section's blocks sometimes lead with a "Learning Objectives" block that just restates
	// section.objectives[] (already shown in the header below). Suppress the visible duplicate
	// but keep its anchor addressable — see Block.svelte's `hidden` prop.
	function isRedundantObjectivesBlock(index: number): boolean {
		const block = data.section.blocks[index];
		return index === 0 && block?.heading === 'Learning Objectives' && data.section.objectives.length > 0;
	}

	// `trail` is the heading breadcrumb down to (and usually including) the block's own heading,
	// which the block's html already renders as an <h2>. Drop that last, duplicate segment and
	// only show the ancestor path — and only when it differs from the previous visible block's,
	// so a run of blocks under the same sub-heading doesn't repeat it.
	function ancestorBreadcrumb(index: number): string[] {
		const block = data.section.blocks[index];
		const trail =
			block.trail.length > 0 && block.trail[block.trail.length - 1] === block.heading
				? block.trail.slice(0, -1)
				: block.trail;
		const prev = index > 0 ? data.section.blocks[index - 1] : null;
		if (prev) {
			const prevTrail =
				prev.trail.length > 0 && prev.trail[prev.trail.length - 1] === prev.heading
					? prev.trail.slice(0, -1)
					: prev.trail;
			if (JSON.stringify(prevTrail) === JSON.stringify(trail)) return [];
		}
		return trail;
	}

	// Persist reading position (per book slug) whenever the visited section changes, and record it
	// in the visited-sections set the prerequisite panel uses to dim already-seen concepts.
	$effect(() => {
		savePosition(data.slug, data.section.id);
		visitedSections = markSectionVisited(data.slug, data.section.id);
		closeAllPopovers();
	});

	// Deep links: /read/[sectionId]#<anchor> scrolls to and briefly highlights that block. Runs
	// after every navigation (not just mount) so in-page anchor links work on repeat visits too.
	afterNavigate(() => {
		const hash = window.location.hash.slice(1);
		if (!hash) return;
		const target = document.getElementById(hash);
		if (!target) return;
		target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
		target.classList.add('flash-highlight');
		setTimeout(() => target.classList.remove('flash-highlight'), 2000);
	});

</script>

<svelte:head>
	<title>{data.section.title} — {data.section.number ? `${data.section.number} · ` : ''}GenOER Reader</title>
</svelte:head>

<article class="section-content">
	<header class="section-header">
		{#if data.section.number}
			<span class="section-number">Section {data.section.number}</span>
		{/if}
		<h1 class="section-title">{data.section.title}</h1>
		{#if data.section.objectives.length > 0}
			<section class="section-objectives" aria-label="Learning objectives">
				<h2>Learning Objectives</h2>
				<p>By the end of this section, you will be able to:</p>
				<ul>
					{#each data.section.objectives as objective (objective)}
						<li>{objective}</li>
					{/each}
				</ul>
			</section>
		{/if}
		{#if glossaryConcepts.length > 0}
			<a class="section-map-link" href="/map?concept={glossaryConcepts.map((c) => encodeURIComponent(c.id)).join(',')}&view=neighborhood{bookAmp}">
				View this section's concepts in the map &rarr;
			</a>
		{/if}
		<a class="section-map-link" href="/practice/{data.section.id}{bookSuffix}">
			Practice this section &rarr;
		</a>
		<JsonViewer
			data={data.section}
			label="View this section's JSON"
			filename="{data.slug}-{data.section.id}.json"
		/>
	</header>

	{#if data.graph}
		<PrerequisitePanel graph={data.graph} sectionId={data.section.id} {visitedSections} />
	{/if}

	{#each data.section.blocks as block, i (block.anchor)}
		<Block
			{block}
			mediaBase={media}
			hidden={isRedundantObjectivesBlock(i)}
			breadcrumb={ancestorBreadcrumb(i)}
			{glossaryConcepts}
			userHighlights={highlightsFor(block.anchor)}
			hasBlockNote={!!blockNoteFor(block.anchor)}
			onConceptActivate={openConceptCard}
			onHighlightActivate={openHighlightCard}
			onBlockNoteActivate={(target) => openBlockNote(block.anchor, target)}
		/>
	{/each}

	{#if data.section.footnotes?.length}
		<!-- Footnotes extracted by the converter — in-text superscript markers
		     (#fnrefN) link down here; each entry links back up. -->
		<section class="section-footnotes" aria-label="Footnotes">
			<h2>Footnotes</h2>
			<ol>
				{#each data.section.footnotes as fn, n (fn.id)}
					<li id={fn.id}>
						<!-- eslint-disable-next-line svelte/no-at-html-tags — converter-produced HTML, same trust level as block html -->
						{@html fn.html}
						<a class="footnote-backref" href="#fnref{n + 1}" aria-label="Back to reference {n + 1}">↩</a>
					</li>
				{/each}
			</ol>
		</section>
	{/if}

	<SectionNav prev={data.prev} next={data.next} />
</article>

<SelectionToolbar slug={data.slug} section={data.section} onNoteRequest={openNoteForHighlight} />

{#if data.graph && activeConceptId}
	<ConceptCard
		graph={data.graph}
		conceptId={activeConceptId}
		anchorRect={activeAnchorRect}
		currentSectionId={data.section.id}
		onClose={closeConceptCard}
		onSelectConcept={(id) => (activeConceptId = id)}
	/>
{/if}

{#if activeHighlightId}
	{@const h = sectionHighlights.find((x) => x.id === activeHighlightId)}
	{#if h}
		<!-- Keyed on the highlight id so switching directly from one highlight's popover to another's
		     (both under the same `{#if}` branch) remounts the card rather than reusing an instance
		     whose `draft`/`editing` $state was initialized from the previous highlight's note. -->
		{#key h.id}
			<HighlightCard
				slug={data.slug}
				highlight={h}
				note={sectionNotes.find((n) => n.highlightId === h.id) ?? null}
				anchorRect={activeHighlightRect}
				autoEdit={highlightAutoEdit}
				onClose={closeAllPopoversAndRestoreFocus}
			/>
		{/key}
	{/if}
{/if}

{#if activeNoteBlockAnchor}
	{#key activeNoteBlockAnchor}
		<BlockNoteCard
			slug={data.slug}
			blockAnchor={activeNoteBlockAnchor}
			sectionId={data.section.id}
			sectionTitle={data.section.title}
			sectionNumber={data.section.number}
			note={blockNoteFor(activeNoteBlockAnchor) ?? null}
			anchorRect={activeNoteRect}
			onClose={closeAllPopovers}
		/>
	{/key}
{/if}
