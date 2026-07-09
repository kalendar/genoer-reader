<script lang="ts">
	/**
	 * Learning pathways (SPEC.md §7 "Learning pathways" — "Show me the path to
	 * understanding X"): pure traversal over the prerequisite DAG, no
	 * generation. `prerequisitePathway` (built for exactly this in
	 * `$lib/data/graph`, M2) computes the ancestor subgraph and topologically
	 * orders it; this route just renders that as a reading list plus a link
	 * into the map's prerequisite view for the same concept.
	 *
	 * Reachable from a concept card or map node detail ("Path to this
	 * concept"), or by searching directly here.
	 */
	import { browser } from '$app/environment';
	import type { ConceptNode, SearchResult } from '$lib/data/graph';
	import { prerequisitePathway } from '$lib/data/graph';
	import MapSearch from '$lib/components/map/MapSearch.svelte';
	import { bookQuerySuffix, bookAmpParam } from '$lib/utils/book-link';
	import { base } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let graph = $derived(data.graph);
	let bookSuffix = $derived(bookQuerySuffix());
	let bookAmp = $derived(bookAmpParam());

	// Initial concept from the URL (?concept=<id>), same window.location pattern /map uses — this
	// whole route is prerendered, and `page.url.searchParams` is locked during that pass.
	const initialParams = browser ? new URLSearchParams(window.location.search) : new URLSearchParams();
	let conceptId = $state<string | null>(initialParams.get('concept'));

	let target: ConceptNode | undefined = $derived(
		graph && conceptId ? graph.conceptsById.get(conceptId) : undefined
	);

	let pathway = $derived.by(() => {
		if (!graph || !target) return [];
		return prerequisitePathway(graph, target.id);
	});

	let priorSteps = $derived(pathway.slice(0, -1));

	let sampleConcepts: ConceptNode[] = $derived.by(() => {
		if (!graph) return [];
		const perChapter = new Map<number, ConceptNode>();
		for (const c of graph.data.nodes.concepts) {
			if (c.chapter != null && !perChapter.has(c.chapter)) perChapter.set(c.chapter, c);
		}
		return [...perChapter.values()].slice(0, 6);
	});

	function handleSearchSelect(result: SearchResult) {
		if (result.node.kind !== 'concept') return;
		conceptId = result.node.id;
	}
</script>

<svelte:head>
	<title>Learning pathways — GenOER Reader</title>
</svelte:head>

<main class="pathways-page">
	<header class="pathways-header">
		<h1>Learning pathways</h1>
		<p class="pathways-intro">
			Pick a concept and see everything you'd need to understand first — traced straight from
			the book's prerequisite graph, in reading order. Nothing here is generated; it's a
			traversal of verified <code>depends-on</code> relationships.
		</p>
		<div class="pathways-search">
			{#if graph}
				<MapSearch {graph} placeholder="Search for a concept…" onSelect={handleSearchSelect} />
			{/if}
		</div>
	</header>

	{#if !graph}
		<p class="map-no-graph">
			This book doesn't ship a knowledge graph, so learning pathways aren't available for it
			(SPEC.md §8: missing graph ⇒ pathways disable, the reader still works normally).
		</p>
	{:else if !target}
		<div class="map-empty-state">
			<p>Search for a concept above to see its pathway, or try one:</p>
			<div class="map-sample-chips">
				{#each sampleConcepts as concept (concept.id)}
					<button type="button" onclick={() => (conceptId = concept.id)}>{concept.term}</button>
				{/each}
			</div>
		</div>
	{:else}
		<div class="pathway-result">
			<div class="pathway-result-head">
				<h2>Path to understanding <em>{target.term}</em></h2>
				<a
					class="pathway-graph-link"
					href="{base}/map?concept={encodeURIComponent(target.id)}&view=prerequisite{bookAmp}"
				>
					View as graph &rarr;
				</a>
			</div>

			{#if priorSteps.length === 0}
				<p class="pathway-empty">
					No prerequisites recorded for this concept — it doesn't depend on anything else in the
					graph, so you can dive right in.
				</p>
			{:else}
				<p class="pathway-count">
					{priorSteps.length} concept{priorSteps.length === 1 ? '' : 's'} to know first, in order:
				</p>
			{/if}

			<ol class="pathway-list">
				{#each pathway as step, i (step.concept.id)}
					<li class="pathway-step" class:pathway-step-goal={i === pathway.length - 1 && priorSteps.length > 0}>
						<span class="pathway-step-index">{i === pathway.length - 1 && priorSteps.length > 0 ? 'Goal' : i + 1}</span>
						<div class="pathway-step-body">
							{#if step.section}
								<a class="pathway-step-term" href="{base}/read/{step.section.module}{bookSuffix}">{step.concept.term}</a>
							{:else}
								<span class="pathway-step-term">{step.concept.term}</span>
							{/if}
							<p class="pathway-step-definition">{step.concept.definition}</p>
							{#if step.section}
								<span class="pathway-step-source">
									Defined in {step.section.number ? `§${step.section.number} ` : ''}{step.section.title}
								</span>
							{/if}
						</div>
					</li>
				{/each}
			</ol>
		</div>
	{/if}
</main>

<style>
	.pathways-page {
		max-width: var(--measure);
		margin: 0 auto;
		padding: var(--space-2) var(--space-2) var(--space-4);
		font-family: var(--font-ui);
	}

	.pathways-header h1 {
		font-size: 1.6rem;
		margin: 0 0 0.4rem;
	}

	.pathways-intro {
		color: var(--color-text-muted);
		max-width: 38rem;
	}

	.pathways-intro code {
		background: var(--color-bg-raised);
		border: 1px solid var(--color-border);
		border-radius: 0.2rem;
		padding: 0.05rem 0.3rem;
		font-size: 0.85em;
	}

	.pathways-search {
		max-width: 26rem;
		margin: var(--space-2) 0 var(--space-3);
	}

	.map-empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		border: 1px dashed var(--color-border);
		border-radius: 0.4rem;
		color: var(--color-text-muted);
		text-align: center;
		padding: var(--space-4);
	}

	.map-sample-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		justify-content: center;
	}

	.map-sample-chips button {
		background: var(--color-bg-raised);
		border: 1px solid var(--color-border);
		border-radius: 1rem;
		padding: 0.3rem 0.8rem;
		cursor: pointer;
		color: var(--color-text);
		font-size: 0.85rem;
	}

	.map-sample-chips button:hover {
		border-color: var(--color-accent);
	}

	.pathway-result-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.pathway-result-head h2 {
		font-family: var(--font-reading);
		font-size: 1.3rem;
		margin: 0;
	}

	.pathway-graph-link {
		font-weight: 600;
		font-size: 0.85rem;
		white-space: nowrap;
	}

	.pathway-empty,
	.pathway-count {
		color: var(--color-text-muted);
		margin: var(--space-1) 0 var(--space-2);
	}

	.pathway-list {
		list-style: none;
		margin: var(--space-2) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	.pathway-step {
		display: flex;
		gap: var(--space-2);
		padding: var(--space-2) 0;
		border-left: 2px solid var(--color-border);
		padding-left: var(--space-2);
		position: relative;
	}

	.pathway-step:not(:last-child)::after {
		content: '';
	}

	.pathway-step-index {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.8rem;
		height: 1.8rem;
		border-radius: 50%;
		background: var(--color-bg-raised);
		border: 1px solid var(--color-border);
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--color-text-muted);
		margin-left: -1.95rem;
		background-clip: padding-box;
	}

	.pathway-step-goal .pathway-step-index {
		background: var(--color-accent);
		color: var(--color-accent-contrast);
		border-color: var(--color-accent);
		font-size: 0.65rem;
	}

	.pathway-step-body {
		flex: 1 1 auto;
		padding-bottom: var(--space-1);
	}

	.pathway-step-term {
		font-family: var(--font-reading);
		font-weight: 700;
		font-size: 1.05rem;
		text-decoration: none;
	}

	.pathway-step-definition {
		margin: 0.2rem 0;
		color: var(--color-text);
	}

	.pathway-step-source {
		font-size: 0.78rem;
		color: var(--color-text-muted);
	}
</style>
