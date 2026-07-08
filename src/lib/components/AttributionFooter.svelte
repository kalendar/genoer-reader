<script lang="ts">
	import type { Book } from '$lib/data/book';
	import { buildAttributionText, licenseCodes, hasRestrictiveTerms } from '$lib/utils/attribution';

	let { book }: { book: Book } = $props();

	let attributionText = $derived(buildAttributionText(book));
	let codes = $derived(licenseCodes(book.license));
	let restrictive = $derived(hasRestrictiveTerms(book.license));

	let copied = $state(false);
	let copyTimeout: ReturnType<typeof setTimeout> | undefined;

	async function copyAttribution() {
		try {
			await navigator.clipboard.writeText(attributionText);
			copied = true;
			clearTimeout(copyTimeout);
			copyTimeout = setTimeout(() => {
				copied = false;
			}, 2000);
		} catch {
			// Clipboard API unavailable or permission denied — fail silently, button stays "Copy".
		}
	}
</script>

<footer class="attribution-footer">
	<p class="attribution-text">
		<strong>{book.title}</strong> by {book.publisher} &middot; licensed
		<a href={book.license_url} rel="license noopener noreferrer" target="_blank">{book.license}</a>
		{#if restrictive}
			<span class="license-badges" aria-label="License terms">
				{#each codes as code (code)}<span class="license-badge">{code}</span>{/each}
			</span>
		{/if}
	</p>
	<button type="button" class="copy-attribution" onclick={copyAttribution}>
		{copied ? 'Copied!' : 'Copy attribution'}
	</button>
</footer>
