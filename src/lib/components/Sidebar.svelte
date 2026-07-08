<script lang="ts">
	import type { TocEntry } from '$lib/data/book';

	let {
		toc,
		currentSectionId = null,
		open = false,
		onClose
	}: {
		toc: TocEntry[];
		currentSectionId?: string | null;
		open?: boolean;
		onClose?: () => void;
	} = $props();
</script>

<nav id="toc-sidebar" class="toc-sidebar" class:open aria-label="Table of contents">
	<div class="toc-sidebar-header">
		<span class="toc-sidebar-title">Contents</span>
		<button
			type="button"
			class="toc-close"
			onclick={() => onClose?.()}
			aria-label="Close table of contents"
		>
			&times;
		</button>
	</div>
	<ul class="toc-list">
		{#each toc as entry, i (entry.id ?? `heading-${i}`)}
			{#if entry.heading}
				<li class="toc-chapter">
					{entry.chapter != null ? `Chapter ${entry.chapter}: ` : ''}{entry.title}
				</li>
			{:else if entry.id}
				<li>
					<a
						href="/read/{entry.id}"
						aria-current={currentSectionId === entry.id ? 'page' : undefined}
						onclick={() => onClose?.()}
					>
						{#if entry.number}<span class="toc-number">{entry.number}</span>{/if}
						{entry.title}
					</a>
				</li>
			{/if}
		{/each}
	</ul>
</nav>
{#if open}
	<button
		type="button"
		class="toc-scrim"
		aria-hidden="true"
		tabindex="-1"
		onclick={() => onClose?.()}
	></button>
{/if}
