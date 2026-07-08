<script lang="ts">
	import { browser } from '$app/environment';
	import { replaceState } from '$app/navigation';
	import type {
		EdgeType,
		GraphNode,
		Subgraph,
		SearchResult,
		ConceptNode
	} from '$lib/data/graph';
	import {
		egoNeighborhood,
		chapterSubgraph,
		fullPrerequisiteDag,
		prerequisiteAncestors,
		prerequisiteDescendants,
		dependsOnEdgesAmong
	} from '$lib/data/graph';
	import { buildElements } from '$lib/utils/map-elements';
	import ConceptMapCanvas from '$lib/components/map/ConceptMapCanvas.svelte';
	import MapLegend from '$lib/components/map/MapLegend.svelte';
	import MapSearch from '$lib/components/map/MapSearch.svelte';
	import NodeDetailPanel from '$lib/components/map/NodeDetailPanel.svelte';
	import MapListView from '$lib/components/map/MapListView.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let graph = $derived(data.graph);

	type ViewKind = 'neighborhood' | 'chapter' | 'prerequisite';
	type PrereqMode = 'ancestors' | 'descendants' | 'both';

	// Initial state from the URL (SPEC.md §6 "Deep-linkable, e.g. /map?concept=<id>&view=neighborhood").
	// Read once at component init from `window.location` rather than `page.url.searchParams` — the
	// latter is deliberately locked during the prerendering SSR pass (this whole route is
	// prerendered, SPEC.md §2), and `window.location` sidesteps that since it's simply unavailable
	// (and unused, via the `browser` guard) at prerender time. The effect below keeps the URL in
	// sync with state from then on via shallow routing (`replaceState`), which does not re-run `load`.
	const initialParams = browser ? new URLSearchParams(window.location.search) : new URLSearchParams();
	// Preserved verbatim through every shallow-routed URL rewrite below (SPEC.md §8) — the effect
	// that follows rebuilds the whole query string from view/concept/chapter/etc. state, and without
	// this it would silently strip `?book=` the instant the reader touches the map (selects a node,
	// switches views, ...), losing which book is open on this route.
	const bookParam = initialParams.get('book');
	const initialView = initialParams.get('view');
	const initialConcepts = (initialParams.get('concept') ?? '')
		.split(',')
		.map((s) => decodeURIComponent(s.trim()))
		.filter(Boolean);

	let view = $state<ViewKind>(initialView === 'chapter' || initialView === 'prerequisite' ? initialView : 'neighborhood');
	let centerConceptIds = $state<string[]>(initialConcepts);
	let chapterNum = $state<number | null>(
		initialParams.get('chapter') ? Number(initialParams.get('chapter')) : null
	);
	let prereqMode = $state<PrereqMode>(
		(initialParams.get('mode') as PrereqMode) === 'ancestors' || (initialParams.get('mode') as PrereqMode) === 'descendants'
			? (initialParams.get('mode') as PrereqMode)
			: 'both'
	);
	let neighborhoodDepth = $state(1);
	let selectedNodeId = $state<string | null>(initialParams.get('node') ?? initialConcepts[0] ?? null);
	let hiddenEdgeTypes = $state<Set<EdgeType>>(new Set());
	let viewMode = $state<'canvas' | 'list'>('canvas');

	// Default the chapter picker to the first center concept's chapter, or chapter 1, the first
	// time the reader switches into Chapter view with nothing chosen yet.
	$effect(() => {
		if (view !== 'chapter' || !graph || chapterNum != null) return;
		const fromCenter = centerConceptIds[0] ? graph.conceptsById.get(centerConceptIds[0])?.chapter : null;
		chapterNum = fromCenter ?? graph.chapters[0] ?? null;
	});

	// Keep the URL deep-linkable without re-running this page's `load` (shallow routing).
	$effect(() => {
		const sp = new URLSearchParams();
		sp.set('view', view);
		if (view !== 'chapter' && centerConceptIds.length > 0) {
			sp.set('concept', centerConceptIds.map(encodeURIComponent).join(','));
		}
		if (view === 'chapter' && chapterNum != null) sp.set('chapter', String(chapterNum));
		if (view === 'prerequisite' && centerConceptIds.length > 0) sp.set('mode', prereqMode);
		if (selectedNodeId) sp.set('node', selectedNodeId);
		if (bookParam) sp.set('book', bookParam);
		replaceState(`?${sp.toString()}`, {});
	});

	function toggleEdgeType(type: EdgeType) {
		const next = new Set(hiddenEdgeTypes);
		if (next.has(type)) next.delete(type);
		else next.add(type);
		hiddenEdgeTypes = next;
	}

	let subgraph: Subgraph = $derived.by(() => {
		if (!graph) return { nodes: [], edges: [] };

		if (view === 'neighborhood') {
			const centers = centerConceptIds.filter((id) => graph.conceptsById.has(id)).slice(0, 6);
			if (centers.length === 0) return { nodes: [], edges: [] };
			const nodeMap = new Map<string, GraphNode>();
			const edgeMap = new Map<string, Subgraph['edges'][number]>();
			for (const centerId of centers) {
				const ego = egoNeighborhood(graph, centerId, neighborhoodDepth);
				for (const n of ego.nodes) nodeMap.set(n.id, n);
				for (const e of ego.edges) edgeMap.set(`${e.type} ${e.source} ${e.target}`, e);
				const center = graph.conceptsById.get(centerId)!;
				nodeMap.set(center.id, { kind: 'concept', ...center });
				// Anchor each center to its defining section — the "two-way door" back to the reader
				// (SPEC.md §6) — without pulling in every neighbor's defining section too (that would
				// re-introduce the hairball the ego-graph scoping is meant to avoid).
				const section = graph.sectionByModule.get(center.defined_in);
				const definesEdge = (graph.edgesBySource.get(centerId) ?? []).find(
					(e) => e.type === 'defines' && section && e.target === section.id
				);
				if (section && definesEdge) {
					nodeMap.set(section.id, { kind: 'section', ...section });
					edgeMap.set(`defines ${definesEdge.source} ${definesEdge.target}`, definesEdge);
				}
			}
			return { nodes: [...nodeMap.values()], edges: [...edgeMap.values()] };
		}

		if (view === 'chapter') {
			if (chapterNum == null) return { nodes: [], edges: [] };
			return chapterSubgraph(graph, chapterNum);
		}

		// Prerequisite view: the full depends-on DAG by default, filtered to ancestors/descendants
		// of a chosen concept once one is picked (SPEC.md §6).
		const centerId = centerConceptIds[0];
		if (!centerId || !graph.conceptsById.has(centerId)) return fullPrerequisiteDag(graph);
		const ids = new Set<string>([centerId]);
		if (prereqMode === 'ancestors' || prereqMode === 'both') {
			for (const c of prerequisiteAncestors(graph, centerId)) ids.add(c.id);
		}
		if (prereqMode === 'descendants' || prereqMode === 'both') {
			for (const c of prerequisiteDescendants(graph, centerId)) ids.add(c.id);
		}
		const nodes = [...ids].map((id) => graph.nodeById.get(id)).filter((n): n is GraphNode => !!n);
		const edges = dependsOnEdgesAmong(graph, ids);
		return { nodes, edges };
	});

	let visibleEdges = $derived(subgraph.edges.filter((e) => !hiddenEdgeTypes.has(e.type)));
	let visibleSubgraph: Subgraph = $derived({ nodes: subgraph.nodes, edges: visibleEdges });

	let cyElements = $derived(
		buildElements(subgraph.nodes, visibleEdges, view === 'prerequisite' ? { reverseTypes: new Set(['depends-on']) } : {})
	);
	let cyLayout: 'concentric' | 'fcose' | 'dagre' = $derived(
		view === 'neighborhood' ? 'concentric' : view === 'chapter' ? 'fcose' : 'dagre'
	);
	let cyCenterIds = $derived(view === 'chapter' ? [] : centerConceptIds);

	let sampleConcepts: ConceptNode[] = $derived.by(() => {
		if (!graph) return [];
		const perChapter = new Map<number, ConceptNode>();
		for (const c of graph.data.nodes.concepts) {
			if (c.chapter != null && !perChapter.has(c.chapter)) perChapter.set(c.chapter, c);
		}
		return [...perChapter.values()].slice(0, 6);
	});

	function handleSearchSelect(result: SearchResult) {
		selectedNodeId = result.node.id;
		if (result.node.kind !== 'concept') return;
		if (view === 'chapter') {
			chapterNum = result.node.chapter;
		} else {
			centerConceptIds = [result.node.id];
		}
	}

	function selectNode(id: string) {
		selectedNodeId = id;
	}

	function pickChapter(n: number) {
		chapterNum = n;
	}

	function setPrereqCenter(id: string | null) {
		centerConceptIds = id ? [id] : [];
	}
</script>

<svelte:head>
	<title>Concept Map — GenOER Reader</title>
</svelte:head>

<main class="map-page">
	<header class="map-page-header">
		<h1>Concept Map</h1>
		<div class="map-page-search">
			{#if graph}
				<MapSearch {graph} onSelect={handleSearchSelect} />
			{/if}
		</div>
	</header>

	{#if !graph}
		<p class="map-no-graph">
			This book doesn't ship a knowledge graph, so the concept map isn't available for it
			(SPEC.md §8: missing graph ⇒ map disables, the reader still works normally).
		</p>
	{:else}
		<div class="map-toolbar">
			<div class="map-view-tabs" role="tablist" aria-label="Concept map views">
				<button type="button" role="tab" aria-selected={view === 'neighborhood'} onclick={() => (view = 'neighborhood')}>
					Neighborhood
				</button>
				<button type="button" role="tab" aria-selected={view === 'chapter'} onclick={() => (view = 'chapter')}>
					Chapter
				</button>
				<button type="button" role="tab" aria-selected={view === 'prerequisite'} onclick={() => (view = 'prerequisite')}>
					Prerequisite
				</button>
			</div>

			{#if view === 'neighborhood'}
				<label class="map-toolbar-control">
					Depth
					<select bind:value={neighborhoodDepth}>
						<option value={1}>1 hop</option>
						<option value={2}>2 hops</option>
					</select>
				</label>
			{:else if view === 'chapter'}
				<label class="map-toolbar-control">
					Chapter
					<select value={chapterNum} onchange={(e) => pickChapter(Number((e.currentTarget as HTMLSelectElement).value))}>
						{#each graph.chapters as chapter (chapter)}
							<option value={chapter}>{chapter}</option>
						{/each}
					</select>
				</label>
			{:else if view === 'prerequisite'}
				{#if centerConceptIds[0]}
					<div class="map-toolbar-control" role="radiogroup" aria-label="Prerequisite filter">
						<label><input type="radio" name="prereq-mode" checked={prereqMode === 'ancestors'} onchange={() => (prereqMode = 'ancestors')} /> Ancestors</label>
						<label><input type="radio" name="prereq-mode" checked={prereqMode === 'descendants'} onchange={() => (prereqMode = 'descendants')} /> Descendants</label>
						<label><input type="radio" name="prereq-mode" checked={prereqMode === 'both'} onchange={() => (prereqMode = 'both')} /> Both</label>
					</div>
					<button type="button" class="map-toolbar-clear" onclick={() => setPrereqCenter(null)}>Show full DAG</button>
				{:else}
					<span class="map-toolbar-hint">Showing the full prerequisite DAG — search a concept to filter.</span>
				{/if}
			{/if}

			<button type="button" class="map-toolbar-listtoggle" onclick={() => (viewMode = viewMode === 'canvas' ? 'list' : 'canvas')}>
				{viewMode === 'canvas' ? 'Switch to list view' : 'Switch to map view'}
			</button>
		</div>

		<div class="map-layout">
			<div class="map-main">
				{#if view === 'neighborhood' && centerConceptIds.length === 0}
					<div class="map-empty-state">
						<p>Search for a concept above to see its neighborhood, or try one:</p>
						<div class="map-sample-chips">
							{#each sampleConcepts as concept (concept.id)}
								<button type="button" onclick={() => (centerConceptIds = [concept.id])}>{concept.term}</button>
							{/each}
						</div>
					</div>
				{:else if viewMode === 'canvas'}
					<ConceptMapCanvas
						elements={cyElements}
						layoutName={cyLayout}
						centerIds={cyCenterIds}
						selectedId={selectedNodeId}
						onSelect={(id) => (selectedNodeId = id)}
					/>
				{:else}
					<MapListView {graph} subgraph={visibleSubgraph} selectedId={selectedNodeId} onSelectNode={selectNode} />
				{/if}
			</div>

			<div class="map-side">
				<MapLegend hiddenTypes={hiddenEdgeTypes} onToggle={toggleEdgeType} />
				{#if selectedNodeId}
					<NodeDetailPanel {graph} nodeId={selectedNodeId} onClose={() => (selectedNodeId = null)} onSelectNode={selectNode} />
				{/if}
			</div>
		</div>
	{/if}
</main>

<style>
	.map-page {
		max-width: 90rem;
		margin: 0 auto;
		padding: var(--space-2) var(--space-2) var(--space-4);
	}

	.map-page-header {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-2);
		margin-bottom: var(--space-3);
	}

	.map-page-header h1 {
		margin: 0;
		font-size: 1.6rem;
	}

	.map-page-search {
		width: 22rem;
		max-width: 100%;
	}

	.map-no-graph {
		font-family: var(--font-ui);
		color: var(--color-text-muted);
		max-width: var(--measure);
	}

	.map-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
		font-family: var(--font-ui);
		font-size: 0.88rem;
	}

	.map-view-tabs {
		display: flex;
		border: 1px solid var(--color-border);
		border-radius: 0.3rem;
		overflow: hidden;
	}

	.map-view-tabs button {
		background: var(--color-bg-raised);
		border: none;
		padding: 0.45rem 0.9rem;
		cursor: pointer;
		color: var(--color-text);
		border-right: 1px solid var(--color-border);
	}

	.map-view-tabs button:last-child {
		border-right: none;
	}

	.map-view-tabs button[aria-selected='true'] {
		background: var(--color-accent);
		color: var(--color-accent-contrast);
	}

	.map-toolbar-control {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.map-toolbar-control select {
		padding: 0.3rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 0.3rem;
		background: var(--color-bg-raised);
		color: var(--color-text);
	}

	.map-toolbar-clear,
	.map-toolbar-listtoggle {
		background: var(--color-bg-raised);
		border: 1px solid var(--color-border);
		border-radius: 0.3rem;
		padding: 0.4rem 0.8rem;
		cursor: pointer;
		color: var(--color-text);
	}

	.map-toolbar-listtoggle {
		margin-left: auto;
	}

	.map-toolbar-hint {
		color: var(--color-text-muted);
	}

	.map-layout {
		display: grid;
		grid-template-columns: 1fr 20rem;
		gap: var(--space-2);
		align-items: start;
	}

	.map-main {
		height: 65vh;
		min-height: 24rem;
	}

	.map-side {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		max-height: 65vh;
		overflow-y: auto;
	}

	.map-empty-state {
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		border: 1px dashed var(--color-border);
		border-radius: 0.4rem;
		font-family: var(--font-ui);
		color: var(--color-text-muted);
		text-align: center;
		padding: var(--space-3);
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

	@media (max-width: 60rem) {
		.map-layout {
			grid-template-columns: 1fr;
		}

		.map-main {
			height: 50vh;
		}

		.map-side {
			max-height: none;
		}
	}
</style>
