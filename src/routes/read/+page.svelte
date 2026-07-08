<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getPosition } from '$lib/stores/reading-position';
	import { firstSection } from '$lib/data/book';
	import { bookQuerySuffix } from '$lib/utils/book-link';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let first = $derived(firstSection(data.book));

	// Carry the `?book=` param (SPEC.md §8) along with the redirect — without this, jumping from
	// the bare /read to /read/<section> would silently drop which book is open and fall back to the
	// bundled default, since the [sectionId] layout re-derives the book from the URL, not from this
	// page's already-resolved `data`.
	let searchSuffix = $derived(bookQuerySuffix());

	// Progressive enhancement: with JS, silently jump to the saved reading position (or the
	// first section) as soon as we know where that is. Without JS, the link below still works.
	onMount(() => {
		const saved = getPosition(data.slug);
		const targetId = saved?.sectionId ?? first?.id;
		if (targetId) {
			goto(`/read/${targetId}${searchSuffix}`, { replaceState: true });
		}
	});
</script>

<svelte:head>
	<title>{data.book.title} — GenOER Reader</title>
</svelte:head>

<div class="continue-reading">
	<p>Loading the reader…</p>
	{#if first}
		<p><a href="/read/{first.id}{searchSuffix}">Start reading: {first.title}</a></p>
	{/if}
</div>
