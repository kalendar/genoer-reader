<script lang="ts">
	import { page } from '$app/state';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import AttributionFooter from '$lib/components/AttributionFooter.svelte';
	import { setCurrentBook } from '$lib/stores/book';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	// Publish the loaded book to the shared store so later milestones (chat, concept map, study
	// features) can read "the current book" reactively without re-fetching or prop-drilling.
	$effect(() => {
		setCurrentBook(data.slug, data.book);
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
