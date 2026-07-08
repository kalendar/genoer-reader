<script lang="ts">
	import type { Block } from '$lib/data/book';
	import { rewriteMediaSrc } from '$lib/utils/media';

	let {
		block,
		mediaBase,
		breadcrumb = [],
		hidden = false
	}: { block: Block; mediaBase: string; breadcrumb?: string[]; hidden?: boolean } = $props();

	let html = $derived(rewriteMediaSrc(block.html, mediaBase));
</script>

{#if hidden}
	<!-- Content is already shown by the section header (e.g. objectives[]); keep the anchor
	     addressable for deep links and future citations without showing it twice. -->
	<div id={block.anchor} class="block block-anchor-only" data-anchor={block.anchor}></div>
{:else}
	{#if breadcrumb.length > 0}
		<p class="block-trail" aria-hidden="true">{breadcrumb.join(' › ')}</p>
	{/if}
	<div id={block.anchor} class="block" data-anchor={block.anchor}>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html html}
	</div>
{/if}
