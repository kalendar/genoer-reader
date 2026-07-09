<script lang="ts">
	import PracticePanel from '$lib/components/PracticePanel.svelte';
	import { bookQuerySuffix } from '$lib/utils/book-link';
	import { base } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let bookSuffix = $derived(bookQuerySuffix());

	let practiceBlocks = $derived(
		data.section.blocks.map((b) => ({ anchor: b.anchor, text: b.text, heading: b.heading }))
	);
</script>

<svelte:head>
	<title>Practice — {data.section.title} — GenOER Reader</title>
</svelte:head>

<main>
	<PracticePanel
		slug={data.slug}
		sectionId={data.section.id}
		sectionTitle={data.section.title}
		sectionNumber={data.section.number}
		blocks={practiceBlocks}
	/>

	<p class="practice-back">
		<a href="{base}/read/{data.section.id}{bookSuffix}">&larr; Back to {data.section.title}</a>
	</p>
</main>

<style>
	.practice-back {
		max-width: var(--measure);
		margin: 0 auto var(--space-4);
		padding: 0 var(--space-2);
		font-family: var(--font-ui);
		font-size: 0.85rem;
	}
</style>
