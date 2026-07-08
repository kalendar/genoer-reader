<script lang="ts">
	import type { GraphIndex, GraphNode, GraphEdge } from '$lib/data/graph';
	import { getNode } from '$lib/data/graph';
	import JsonViewer from '$lib/components/JsonViewer.svelte';

	let {
		graph,
		nodeId,
		onClose,
		onSelectNode
	}: {
		graph: GraphIndex;
		nodeId: string;
		onClose: () => void;
		onSelectNode: (id: string) => void;
	} = $props();

	let node: GraphNode | undefined = $derived(getNode(graph, nodeId));

	interface EdgeRow {
		edge: GraphEdge;
		otherId: string;
		otherLabel: string;
		direction: 'out' | 'in';
	}

	function labelFor(id: string): string {
		const n = getNode(graph, id);
		if (!n) return id;
		return n.kind === 'concept' ? n.term : n.kind === 'entity' ? n.name : n.title;
	}

	let edgeRows: EdgeRow[] = $derived.by(() => {
		if (!node) return [];
		const out = (graph.edgesBySource.get(node.id) ?? []).map(
			(edge): EdgeRow => ({ edge, otherId: edge.target, otherLabel: labelFor(edge.target), direction: 'out' })
		);
		const inn = (graph.edgesByTarget.get(node.id) ?? []).map(
			(edge): EdgeRow => ({ edge, otherId: edge.source, otherLabel: labelFor(edge.source), direction: 'in' })
		);
		return [...out, ...inn];
	});

	let groupedEdges: Map<string, EdgeRow[]> = $derived.by(() => {
		const groups = new Map<string, EdgeRow[]>();
		for (const row of edgeRows) {
			const list = groups.get(row.edge.type);
			if (list) list.push(row);
			else groups.set(row.edge.type, [row]);
		}
		return groups;
	});

	let definedSection = $derived(
		node?.kind === 'concept' ? graph.sectionByModule.get(node.defined_in) : undefined
	);

	function edgeVerb(type: string, direction: 'out' | 'in'): string {
		const verbs: Record<string, [string, string]> = {
			'is-a': ['is a', 'has specialization'],
			'part-of': ['part of', 'has part'],
			'depends-on': ['depends on', 'is a prerequisite for'],
			'contrasts-with': ['contrasts with', 'contrasts with'],
			'related-to': ['related to', 'related to'],
			illustrates: ['illustrates', 'is illustrated by'],
			defines: ['defines', 'is defined by'],
			mentions: ['mentions', 'is mentioned by'],
			appears_in: ['appears in', 'features'],
			cross_ref: ['cross-references', 'is cross-referenced by'],
			precedes: ['precedes', 'follows']
		};
		const pair = verbs[type];
		if (!pair) return type;
		return direction === 'out' ? pair[0] : pair[1];
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if node}
	<div class="detail-panel" role="dialog" aria-label="Node details">
		<button type="button" class="detail-panel-close" onclick={onClose} aria-label="Close details">&times;</button>

		<p class="detail-panel-kind">{node.kind}</p>
		<h2 class="detail-panel-title">
			{node.kind === 'concept' ? node.term : node.kind === 'entity' ? node.name : node.title}
		</h2>

		{#if node.kind === 'concept'}
			<p class="detail-panel-definition">{node.definition}</p>
			{#if node.chapter != null}
				<p class="detail-panel-row">Chapter {node.chapter}</p>
			{/if}
			{#if definedSection}
				<p class="detail-panel-row">
					Defined in
					<a href="/read/{definedSection.module}">
						{definedSection.number ? `${definedSection.number} ` : ''}{definedSection.title}
					</a>
				</p>
			{/if}
		{:else if node.kind === 'entity'}
			<p class="detail-panel-row">Mentioned in {node.count} place{node.count === 1 ? '' : 's'}.</p>
		{:else}
			{#if node.chapter != null}<p class="detail-panel-row">Chapter {node.chapter}</p>{/if}
			<p class="detail-panel-row">
				<a href="/read/{node.module}">Open in reader &rarr;</a>
			</p>
		{/if}

		{#if groupedEdges.size > 0}
			<div class="detail-panel-edges">
				<span class="detail-panel-label">Connections</span>
				{#each [...groupedEdges.entries()] as [type, rows] (type)}
					<div class="detail-edge-group">
						<span class="detail-edge-type">{type}</span>
						<ul>
							{#each rows as row (row.edge.type + row.direction + row.otherId)}
								<li>
									<button type="button" class="detail-edge-link" onclick={() => onSelectNode(row.otherId)}>
										{edgeVerb(row.edge.type, row.direction)} <strong>{row.otherLabel}</strong>
									</button>
									{#if row.edge.verified}
										<span class="verified-badge" title="Adversarially verified at build time">verified</span>
									{/if}
									{#if row.edge.evidence}
										<p class="detail-edge-evidence">&ldquo;{row.edge.evidence}&rdquo;</p>
									{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/each}
			</div>
		{/if}

		{#if node.kind === 'concept'}
			<a class="detail-panel-map-link" href="/map?concept={encodeURIComponent(node.id)}&view=neighborhood">
				Center neighborhood view here
			</a>
			<a class="detail-panel-map-link" href="/pathways?concept={encodeURIComponent(node.id)}">
				Path to this concept &rarr;
			</a>
		{/if}

		<JsonViewer data={node} label="View this node's JSON" filename="{node.kind}-{node.id}.json" />
		{#if edgeRows.length > 0}
			<JsonViewer
				data={edgeRows.map((r) => r.edge)}
				label="View this node's edges JSON ({edgeRows.length})"
				filename="{node.kind}-{node.id}-edges.json"
			/>
		{/if}
	</div>
{/if}

<style>
	.detail-panel {
		background: var(--color-bg-raised);
		border: 1px solid var(--color-border);
		border-radius: 0.4rem;
		padding: var(--space-2);
		font-family: var(--font-ui);
		font-size: 0.88rem;
		overflow-y: auto;
	}

	.detail-panel-close {
		float: right;
		background: none;
		border: none;
		font-size: 1.3rem;
		line-height: 1;
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.detail-panel-kind {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		margin: 0;
	}

	.detail-panel-title {
		font-family: var(--font-reading);
		font-size: 1.2rem;
		margin: 0.2rem 1.6rem 0.5rem 0;
	}

	.detail-panel-definition {
		margin: 0 0 var(--space-1);
	}

	.detail-panel-row {
		margin: 0 0 0.4rem;
		color: var(--color-text-muted);
	}

	.detail-panel-row a {
		color: var(--color-link);
	}

	.detail-panel-label {
		display: block;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		margin: var(--space-2) 0 0.4rem;
	}

	.detail-edge-group {
		margin-bottom: var(--space-1);
	}

	.detail-edge-type {
		font-weight: 600;
		font-size: 0.78rem;
	}

	.detail-edge-group ul {
		list-style: none;
		margin: 0.25rem 0 0;
		padding: 0;
	}

	.detail-edge-group li {
		margin-bottom: 0.4rem;
	}

	.detail-edge-link {
		background: none;
		border: none;
		padding: 0;
		color: var(--color-text);
		cursor: pointer;
		font-size: 0.85rem;
		text-align: left;
	}

	.detail-edge-link:hover {
		color: var(--color-link);
	}

	.detail-edge-evidence {
		margin: 0.15rem 0 0;
		color: var(--color-text-muted);
		font-style: italic;
		font-size: 0.8rem;
	}

	.verified-badge {
		font-size: 0.62rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-accent);
		border: 1px solid var(--color-accent);
		border-radius: 0.2rem;
		padding: 0.02rem 0.28rem;
		margin-left: 0.3rem;
	}

	.detail-panel-map-link {
		display: block;
		margin-top: var(--space-2);
		font-weight: 600;
		font-size: 0.85rem;
	}
</style>
