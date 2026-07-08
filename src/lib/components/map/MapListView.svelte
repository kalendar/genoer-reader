<script lang="ts">
	import type { GraphIndex, GraphNode, GraphEdge, Subgraph } from '$lib/data/graph';
	import { nodeLabel } from '$lib/utils/map-elements';

	/**
	 * The graph's list-view equivalent (SPEC.md §10: "the concept map gets a list-view equivalent
	 * ... so the graph's content is never canvas-only"). Renders exactly the same scoped subgraph
	 * the canvas would draw, as node headings each followed by their edges grouped by type and
	 * rendered as links — every canvas interaction (select a node, follow an edge, open the reader)
	 * has a keyboard/screen-reader-reachable equivalent here.
	 */
	let {
		graph,
		subgraph,
		selectedId = null,
		onSelectNode
	}: {
		graph: GraphIndex;
		subgraph: Subgraph;
		selectedId?: string | null;
		onSelectNode: (id: string) => void;
	} = $props();

	interface EdgeRow {
		edge: GraphEdge;
		otherId: string;
		otherLabel: string;
	}

	let sortedNodes: GraphNode[] = $derived(
		[...subgraph.nodes].sort((a, b) => nodeLabel(a).localeCompare(nodeLabel(b)))
	);

	let nodeIdSet = $derived(new Set(subgraph.nodes.map((n) => n.id)));
	let byId = $derived(new Map(subgraph.nodes.map((n) => [n.id, n])));

	function edgesFor(id: string): Map<string, EdgeRow[]> {
		const groups = new Map<string, EdgeRow[]>();
		for (const edge of subgraph.edges) {
			let otherId: string | null = null;
			if (edge.source === id) otherId = edge.target;
			else if (edge.target === id) otherId = edge.source;
			if (!otherId || !nodeIdSet.has(otherId)) continue;
			const other = byId.get(otherId);
			const row: EdgeRow = { edge, otherId, otherLabel: other ? nodeLabel(other) : otherId };
			const list = groups.get(edge.type);
			if (list) list.push(row);
			else groups.set(edge.type, [row]);
		}
		return groups;
	}
</script>

<div class="map-list-view">
	{#if sortedNodes.length === 0}
		<p class="map-list-empty">Nothing in this view yet.</p>
	{/if}
	<ul class="map-list">
		{#each sortedNodes as node (node.id)}
			{@const edges = edgesFor(node.id)}
			<li id="list-node-{node.id}" class="map-list-node" class:map-list-node-selected={node.id === selectedId}>
				<button type="button" class="map-list-node-heading" onclick={() => onSelectNode(node.id)}>
					<span class="map-list-node-kind">{node.kind}</span>
					{nodeLabel(node)}
				</button>
				{#if node.kind === 'concept'}
					<p class="map-list-node-def">{node.definition}</p>
				{/if}
				{#if edges.size > 0}
					{#each [...edges.entries()] as [type, rows] (type)}
						<div class="map-list-edge-group">
							<span class="map-list-edge-type">{type}</span>
							<ul>
								{#each rows as row (row.edge.source + row.edge.target + row.edge.type)}
									<li>
										<a href="#list-node-{row.otherId}" onclick={() => onSelectNode(row.otherId)}>
											{row.otherLabel}
										</a>
										{#if row.edge.evidence}
											<span class="map-list-evidence">— &ldquo;{row.edge.evidence}&rdquo;</span>
										{/if}
									</li>
								{/each}
							</ul>
						</div>
					{/each}
				{/if}
			</li>
		{/each}
	</ul>
</div>

<style>
	.map-list-view {
		background: var(--color-bg-raised);
		border: 1px solid var(--color-border);
		border-radius: 0.4rem;
		padding: var(--space-2) var(--space-3);
		font-family: var(--font-ui);
		font-size: 0.88rem;
		height: 100%;
		overflow-y: auto;
	}

	.map-list-empty {
		color: var(--color-text-muted);
	}

	.map-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.map-list-node {
		padding: var(--space-2) 0;
		border-bottom: 1px solid var(--color-border);
	}

	.map-list-node:last-child {
		border-bottom: none;
	}

	.map-list-node-selected {
		background: var(--color-highlight);
		margin: 0 calc(-1 * var(--space-2));
		padding-left: var(--space-2);
		padding-right: var(--space-2);
		border-radius: 0.3rem;
	}

	.map-list-node-heading {
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		font-family: var(--font-reading);
		font-weight: 700;
		font-size: 1.05rem;
		color: var(--color-text);
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}

	.map-list-node-kind {
		font-family: var(--font-ui);
		font-weight: 400;
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-muted);
	}

	.map-list-node-def {
		margin: 0.2rem 0 0.5rem;
		color: var(--color-text-muted);
	}

	.map-list-edge-group {
		margin-top: 0.4rem;
	}

	.map-list-edge-type {
		font-weight: 600;
		font-size: 0.78rem;
	}

	.map-list-edge-group ul {
		list-style: none;
		margin: 0.2rem 0 0;
		padding: 0;
	}

	.map-list-edge-group li {
		margin-bottom: 0.2rem;
		font-size: 0.85rem;
	}

	.map-list-evidence {
		color: var(--color-text-muted);
		font-style: italic;
		font-size: 0.8rem;
	}
</style>
