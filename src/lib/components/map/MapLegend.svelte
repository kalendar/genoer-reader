<script lang="ts">
	import type { EdgeType } from '$lib/data/graph';

	let {
		hiddenTypes,
		onToggle
	}: {
		hiddenTypes: Set<EdgeType>;
		onToggle: (type: EdgeType) => void;
	} = $props();

	const EDGE_TYPES: { type: EdgeType; label: string; cssVar: string; dash: string; verified: boolean }[] = [
		{ type: 'depends-on', label: 'depends on', cssVar: '--map-edge-depends-on', dash: 'solid', verified: true },
		{ type: 'is-a', label: 'is a', cssVar: '--map-edge-is-a', dash: 'solid', verified: true },
		{ type: 'part-of', label: 'part of', cssVar: '--map-edge-part-of', dash: 'solid', verified: true },
		{ type: 'contrasts-with', label: 'contrasts with', cssVar: '--map-edge-contrasts-with', dash: 'dashed', verified: true },
		{ type: 'related-to', label: 'related to', cssVar: '--map-edge-related-to', dash: 'dotted', verified: true },
		{ type: 'illustrates', label: 'illustrates (entity)', cssVar: '--map-edge-illustrates', dash: 'dotted', verified: true },
		{ type: 'defines', label: 'defined in (section)', cssVar: '--map-edge-structural', dash: 'dashed', verified: false }
	];
</script>

<fieldset class="map-legend">
	<legend>Legend</legend>

	<div class="legend-group">
		<span class="legend-title">Node kinds</span>
		<span class="legend-item">
			<span class="legend-node legend-node-concept" aria-hidden="true"></span>
			Concept
		</span>
		<span class="legend-item">
			<span class="legend-node legend-node-entity" aria-hidden="true"></span>
			Entity
		</span>
		<span class="legend-item">
			<span class="legend-node legend-node-section" aria-hidden="true"></span>
			Section
		</span>
	</div>

	<div class="legend-group">
		<span class="legend-title">
			Edge types <span class="legend-hint">(click to show/hide)</span>
		</span>
		{#each EDGE_TYPES as edge (edge.type)}
			<label class="legend-toggle">
				<input
					type="checkbox"
					checked={!hiddenTypes.has(edge.type)}
					onchange={() => onToggle(edge.type)}
				/>
				<span class="legend-line" style="border-top-color: var({edge.cssVar}); border-top-style: {edge.dash};" aria-hidden="true"></span>
				{edge.label}
				{#if edge.verified}
					<span class="verified-badge" title="Adversarially verified at build time">verified</span>
				{/if}
			</label>
		{/each}
	</div>
</fieldset>

<style>
	.map-legend {
		border: 1px solid var(--color-border);
		border-radius: 0.4rem;
		padding: var(--space-2);
		font-family: var(--font-ui);
		font-size: 0.82rem;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.map-legend legend {
		font-weight: 700;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		padding: 0 0.3rem;
	}

	.legend-group {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.legend-title {
		font-weight: 600;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.legend-hint {
		font-weight: 400;
	}

	.legend-item,
	.legend-toggle {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.legend-toggle {
		cursor: pointer;
	}

	.legend-node {
		display: inline-block;
		width: 0.8rem;
		height: 0.8rem;
		flex: 0 0 auto;
	}

	.legend-node-concept {
		border-radius: 50%;
		background: var(--map-node-concept);
	}

	.legend-node-entity {
		background: var(--map-node-entity);
		transform: rotate(45deg);
		width: 0.65rem;
		height: 0.65rem;
	}

	.legend-node-section {
		border-radius: 0.15rem;
		border: 2px solid var(--map-node-section);
		background: var(--color-bg-raised);
	}

	.legend-line {
		display: inline-block;
		width: 1.4rem;
		border-top-width: 2px;
		flex: 0 0 auto;
	}

	.verified-badge {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-accent);
		border: 1px solid var(--color-accent);
		border-radius: 0.2rem;
		padding: 0.05rem 0.3rem;
	}
</style>
