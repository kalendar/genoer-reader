<script lang="ts">
	import type { GraphIndex, SearchResult } from '$lib/data/graph';
	import { searchNodes } from '$lib/data/graph';

	let {
		graph,
		placeholder = 'Search terms and entities…',
		onSelect
	}: {
		graph: GraphIndex;
		placeholder?: string;
		onSelect: (result: SearchResult) => void;
	} = $props();

	let query = $state('');
	let open = $state(false);
	let activeIndex = $state(-1);
	let inputEl: HTMLInputElement | undefined = $state();

	let results: SearchResult[] = $derived(query.trim() ? searchNodes(graph, query, 12) : []);

	function pick(result: SearchResult) {
		onSelect(result);
		query = '';
		open = false;
		activeIndex = -1;
		inputEl?.blur();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			if (results.length === 0) return;
			open = true;
			activeIndex = (activeIndex + 1) % results.length;
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			if (results.length === 0) return;
			open = true;
			activeIndex = (activeIndex - 1 + results.length) % results.length;
		} else if (event.key === 'Enter') {
			if (activeIndex >= 0 && results[activeIndex]) {
				event.preventDefault();
				pick(results[activeIndex]);
			} else if (results.length > 0) {
				event.preventDefault();
				pick(results[0]);
			}
		} else if (event.key === 'Escape') {
			if (open) {
				event.preventDefault();
				open = false;
				activeIndex = -1;
			}
		}
	}
</script>

<div class="map-search">
	<label for="map-search-input" class="map-search-label">Search the map</label>
	<input
		id="map-search-input"
		bind:this={inputEl}
		type="text"
		role="combobox"
		aria-expanded={open && results.length > 0}
		aria-controls="map-search-listbox"
		aria-autocomplete="list"
		autocomplete="off"
		{placeholder}
		bind:value={query}
		oninput={() => {
			open = true;
			activeIndex = -1;
		}}
		onfocus={() => (open = true)}
		onkeydown={handleKeydown}
	/>
	{#if open && results.length > 0}
		<ul id="map-search-listbox" class="map-search-results" role="listbox">
			{#each results as result, i (result.node.id)}
				<li role="option" aria-selected={i === activeIndex}>
					<button type="button" class:active={i === activeIndex} onclick={() => pick(result)}>
						<span class="map-search-kind">{result.node.kind}</span>
						{result.label}
					</button>
				</li>
			{/each}
		</ul>
	{:else if open && query.trim()}
		<p class="map-search-empty">No matches for "{query}"</p>
	{/if}
</div>

<style>
	.map-search {
		position: relative;
		font-family: var(--font-ui);
	}

	.map-search-label {
		display: block;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		margin-bottom: 0.3rem;
	}

	.map-search input {
		width: 100%;
		padding: 0.5rem 0.7rem;
		border: 1px solid var(--color-border);
		border-radius: 0.3rem;
		background: var(--color-bg-raised);
		color: var(--color-text);
		font-size: 0.9rem;
	}

	.map-search input:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 1px;
	}

	.map-search-results {
		position: absolute;
		z-index: 40;
		top: calc(100% + 0.2rem);
		left: 0;
		right: 0;
		max-height: 16rem;
		overflow-y: auto;
		margin: 0;
		padding: 0.25rem;
		list-style: none;
		background: var(--color-bg-raised);
		border: 1px solid var(--color-border);
		border-radius: 0.3rem;
		box-shadow: 0 0.4rem 1rem rgb(0 0 0 / 20%);
	}

	.map-search-results button {
		width: 100%;
		text-align: left;
		padding: 0.4rem 0.5rem;
		background: none;
		border: none;
		border-radius: 0.25rem;
		cursor: pointer;
		color: var(--color-text);
		font-size: 0.88rem;
		display: flex;
		gap: 0.5rem;
		align-items: baseline;
	}

	.map-search-results button:hover,
	.map-search-results button.active {
		background: var(--color-bg);
	}

	.map-search-kind {
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-muted);
		min-width: 3.4rem;
	}

	.map-search-empty {
		position: absolute;
		z-index: 40;
		top: calc(100% + 0.2rem);
		left: 0;
		right: 0;
		margin: 0;
		padding: 0.5rem 0.7rem;
		background: var(--color-bg-raised);
		border: 1px solid var(--color-border);
		border-radius: 0.3rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}
</style>
