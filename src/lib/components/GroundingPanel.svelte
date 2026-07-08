<script lang="ts">
	/**
	 * Collapsible "Grounded on these passages" panel (SPEC.md §5 "Answer
	 * presentation"): shows exactly what the model saw, so the retrieval is
	 * transparent. Each passage deep-links into the reader at block granularity.
	 */
	import type { Passage } from '$lib/retrieval';

	let {
		passages,
		matchedTerms = [],
		usedFallback = false
	}: {
		passages: Passage[];
		matchedTerms?: string[];
		usedFallback?: boolean;
	} = $props();

	// Collapsed by default — the panel is opt-in transparency, not noise.
	let expanded = $state(false);
</script>

{#if passages.length > 0}
	<div class="grounding">
		<button
			type="button"
			class="grounding-toggle"
			aria-expanded={expanded}
			onclick={() => (expanded = !expanded)}
		>
			<span class="chevron" class:open={expanded}>▸</span>
			Grounded on {passages.length} passage{passages.length === 1 ? '' : 's'}
			{#if usedFallback}
				<span class="tag">section grounding</span>
			{:else if matchedTerms.length > 0}
				<span class="tag">{matchedTerms.slice(0, 4).join(', ')}{matchedTerms.length > 4 ? '…' : ''}</span>
			{/if}
		</button>

		{#if expanded}
			<ol class="grounding-list">
				{#each passages as p (p.anchor)}
					<li>
						<a class="grounding-cite" href="/read/{p.sectionId}#{p.anchor}">
							[{p.index}]
						</a>
						<div class="grounding-body">
							<div class="grounding-loc">
								{#if p.sectionNumber}<strong>{p.sectionNumber}</strong> {/if}{p.sectionTitle}
								{#if p.isDefinition}<span class="tag def">definition</span>{/if}
							</div>
							<p class="grounding-text">{p.text}</p>
						</div>
					</li>
				{/each}
			</ol>
		{/if}
	</div>
{/if}

<style>
	.grounding {
		margin-top: 0.5rem;
		font-family: var(--font-ui);
		font-size: 0.85rem;
	}

	.grounding-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		background: none;
		border: none;
		padding: 0.2rem 0;
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: 0.8rem;
	}

	.chevron {
		display: inline-block;
		transition: transform 0.15s ease;
	}
	.chevron.open {
		transform: rotate(90deg);
	}

	.tag {
		font-size: 0.7rem;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.6rem;
		padding: 0.05rem 0.5rem;
		color: var(--color-text-muted);
	}
	.tag.def {
		border-color: var(--color-accent);
		color: var(--color-accent);
	}

	.grounding-list {
		list-style: none;
		margin: 0.4rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		border-left: 2px solid var(--color-border);
		padding-left: 0.75rem;
	}

	.grounding-list li {
		display: flex;
		gap: 0.5rem;
	}

	.grounding-cite {
		flex: 0 0 auto;
		color: var(--color-accent);
		text-decoration: none;
		font-weight: 600;
	}

	.grounding-loc {
		color: var(--color-text-muted);
		margin-bottom: 0.15rem;
	}

	.grounding-text {
		margin: 0;
		color: var(--color-text);
		line-height: 1.5;
	}
</style>
