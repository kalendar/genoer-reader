<script lang="ts">
	import type { Section } from '$lib/data/book';

	let { prev, next }: { prev: Section | null; next: Section | null } = $props();
</script>

<nav class="section-nav" aria-label="Section navigation">
	{#if prev}
		<a class="section-nav-link prev" href="/read/{prev.id}" rel="prev">
			<span class="section-nav-label">&larr; Previous</span>
			<span class="section-nav-title">{prev.number ? `${prev.number} ` : ''}{prev.title}</span>
		</a>
	{:else}
		<span class="section-nav-link disabled"></span>
	{/if}
	{#if next}
		<a class="section-nav-link next" href="/read/{next.id}" rel="next">
			<span class="section-nav-label">Next &rarr;</span>
			<span class="section-nav-title">{next.number ? `${next.number} ` : ''}{next.title}</span>
		</a>
	{:else}
		<span class="section-nav-link disabled"></span>
	{/if}
</nav>
