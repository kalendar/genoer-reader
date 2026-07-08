<script lang="ts">
	import PracticePanel from '$lib/components/PracticePanel.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let practiceBlocks = $derived(
		data.section.blocks.map((b) => ({ anchor: b.anchor, text: b.text, heading: b.heading }))
	);
</script>

<svelte:head>
	<title>Practice — {data.section.title} — GenOER Reader</title>
</svelte:head>

<PracticePanel
	slug={data.slug}
	sectionId={data.section.id}
	sectionTitle={data.section.title}
	sectionNumber={data.section.number}
	blocks={practiceBlocks}
/>

<p class="practice-back">
	<a href="/read/{data.section.id}">&larr; Back to {data.section.title}</a>
</p>

<style>
	.practice-back {
		max-width: var(--measure);
		margin: 0 auto var(--space-4);
		padding: 0 var(--space-2);
		font-family: var(--font-ui);
		font-size: 0.85rem;
	}
</style>
