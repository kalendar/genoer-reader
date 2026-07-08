<script lang="ts">
	import { page } from '$app/state';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import AttributionFooter from '$lib/components/AttributionFooter.svelte';
	import { setCurrentBook } from '$lib/stores/book';
	import { setCurrentGraph } from '$lib/stores/graph';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	// Publish the loaded book (and graph, which may be null — SPEC.md §8) to the shared stores so
	// later milestones (chat, concept map, study features) can read "the current book/graph"
	// reactively without re-fetching or prop-drilling.
	$effect(() => {
		setCurrentBook(data.slug, data.book);
		setCurrentGraph(data.slug, data.graph);
	});

	let sidebarOpen = $state(false);
	let currentSectionId = $derived((page.params as { sectionId?: string }).sectionId ?? null);
</script>

<svelte:head>
	<title>{data.book.title} — GenOER Reader</title>
</svelte:head>

<a href="#main-content" class="skip-link">Skip to content</a>

<div class="reader-shell">
	<button
		type="button"
		class="toc-toggle"
		aria-expanded={sidebarOpen}
		aria-controls="toc-sidebar"
		onclick={() => (sidebarOpen = !sidebarOpen)}
	>
		☰ Contents
	</button>

	<Sidebar
		toc={data.book.toc}
		{currentSectionId}
		open={sidebarOpen}
		onClose={() => (sidebarOpen = false)}
	/>

	<main id="main-content" tabindex="-1">
		{@render children()}
	</main>
</div>

<AttributionFooter book={data.book} />
