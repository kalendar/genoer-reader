<script lang="ts">
	import { onMount } from 'svelte';
	import LoadBookForm from '$lib/components/LoadBookForm.svelte';
	import { base } from '$app/paths';
	import { DEFAULT_BOOK_SLUG } from '$lib/data/book';
	import { fetchCatalog, corpusBookDir, type CatalogBook } from '$lib/utils/catalog';

	// The corpus catalog drives the ToC (SPEC.md §8 turned up to the whole
	// OpenStax library): books with a knowledge graph get the full experience,
	// the rest get reader + section-grounded chat. Fetched client-side so new
	// corpus books appear without redeploying the reader.
	let catalogBooks = $state<CatalogBook[] | null>(null);
	let catalogError = $state<string | null>(null);

	onMount(async () => {
		try {
			const catalog = await fetchCatalog();
			catalogBooks = catalog.books;
		} catch (e) {
			catalogError = e instanceof Error ? e.message : String(e);
		}
	});

	const byTitle = (a: CatalogBook, b: CatalogBook) =>
		a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });

	// Group 1: graph-equipped books. The bundled reference book links to the
	// prerendered /read route (local media + graph); any FUTURE corpus book
	// that gains a graph.json auto-promotes here via its hasGraph flag and
	// loads through ?book= like the rest.
	let withGraph = $derived((catalogBooks ?? []).filter((b) => b.hasGraph).sort(byTitle));
	let withoutGraph = $derived((catalogBooks ?? []).filter((b) => !b.hasGraph).sort(byTitle));

	function bookHref(book: CatalogBook): string {
		if (book.slug === DEFAULT_BOOK_SLUG) return `${base}/read`;
		return `${base}/read?book=${encodeURIComponent(corpusBookDir(book.slug))}`;
	}
</script>

<svelte:head>
	<title>GenOER Reader</title>
</svelte:head>

<div class="landing">
	<h1>GenOER Reader</h1>
	<p class="tagline">
		The GenOER Reader is a proof of concept "generative OER." Each and every component of the
		generative OER - its textbook content, knowledge graphs, AI capabilities, and source code -
		are openly licensed, downloadable so you can 5R them, and free to use. The GenOER Reader runs
		entirely in your local browser, meaning no data ever leaves your computer - so it is
		completely private. Please see the <a href="{base}/about">About</a> page for more details!
	</p>
	<p class="tagline">
		The GenOER Reader currently includes all books from the
		<a href="https://openstax.org/subjects" rel="noopener noreferrer" target="_blank">OpenStax</a>
		catalog.
	</p>

	<section class="library" aria-labelledby="library-graph-heading">
		<h2 id="library-graph-heading">Full Text + LLM + Knowledge Graph</h2>
		<ul class="library-list">
			{#if withGraph.length > 0}
				{#each withGraph as book (book.slug)}
					<li><a href={bookHref(book)}>{book.title}</a></li>
				{/each}
			{:else}
				<!-- Catalog still loading (or failed): the bundled book is always available. -->
				<li><a href="{base}/read">Entrepreneurship</a></li>
			{/if}
		</ul>
	</section>

	<section class="library" aria-labelledby="library-text-heading">
		<h2 id="library-text-heading">Full Text + LLM</h2>
		{#if catalogBooks === null && !catalogError}
			<p class="library-status" role="status">Loading the OpenStax library…</p>
		{:else if catalogError}
			<p class="library-status">
				Couldn't load the book catalog ({catalogError}). The bundled book above still works —
				reload to retry.
			</p>
		{:else}
			<ul class="library-list">
				{#each withoutGraph as book (book.slug)}
					<li><a href={bookHref(book)}>{book.title}</a></li>
				{/each}
			</ul>
		{/if}
	</section>

	<p class="landing-about-link">
		Curious how this works, or what "openly licensed all the way down" means here? See
		<a href="{base}/about">the About page</a>.
	</p>

	<section class="landing-loader" aria-labelledby="load-your-own-heading">
		<h2 id="load-your-own-heading">Load your own book</h2>
		<p class="landing-loader-intro">
			Any book converted with
			<a href="https://github.com/kalendar/openstax-convert" rel="noopener noreferrer" target="_blank"
				>openstax-convert</a
			>
			(and optionally
			<a href="https://github.com/kalendar/openstax-graph" rel="noopener noreferrer" target="_blank"
				>openstax-graph</a
			>) works here, unmodified.
		</p>
		<LoadBookForm />
	</section>
</div>
