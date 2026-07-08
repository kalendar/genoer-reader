<script lang="ts">
	import LoadBookForm from '$lib/components/LoadBookForm.svelte';
</script>

<svelte:head>
	<title>GenOER Reader</title>
</svelte:head>

<div class="landing">
	<h1>GenOER Reader</h1>
	<p class="tagline">
		A proof of concept for generative open educational resources — an openly licensed textbook,
		a knowledge graph, and an on-device AI, running entirely in your browser. No backend, no
		accounts, no cost.
	</p>
	<a class="cta" href="/read">Start reading the bundled book &rarr;</a>
	<p class="landing-about-link">
		Curious how this works, or what "openly licensed all the way down" means here? See
		<a href="/about">the About page</a>.
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
