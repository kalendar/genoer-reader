<script lang="ts">
	/**
	 * App-wide error boundary. Most of the time this fires from a `?book=`
	 * load failure (SPEC.md §8 "specific, human-readable errors") — the
	 * message thrown by `$lib/data/resolve-book` is already written for a
	 * reader, not a developer, so it's shown verbatim rather than behind a
	 * generic "Something went wrong."
	 */
	import { page } from '$app/state';
	import { base } from '$app/paths';
</script>

<svelte:head>
	<title>Couldn't load that — GenOER Reader</title>
</svelte:head>

<main class="error-page">
	<h1>Couldn't load that</h1>
	<p class="error-message">{page.error?.message ?? 'Something went wrong.'}</p>
	<p><a href="{base}/">&larr; Back to the landing page</a></p>
</main>

<style>
	.error-page {
		max-width: var(--measure);
		margin: var(--space-4) auto;
		padding: 0 var(--space-2);
		font-family: var(--font-ui);
	}
	.error-message {
		background: var(--color-bg-raised);
		border: 1px solid var(--color-border);
		border-left: 3px solid #a12a2a;
		border-radius: 0 0.3rem 0.3rem 0;
		padding: var(--space-2);
		color: var(--color-text);
	}
</style>
