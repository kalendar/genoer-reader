<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { mediaBase } from '$lib/data/book';
	import { savePosition } from '$lib/stores/reading-position';
	import Block from '$lib/components/Block.svelte';
	import SectionNav from '$lib/components/SectionNav.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let media = $derived(mediaBase(data.slug));

	// A section's blocks sometimes lead with a "Learning Objectives" block that just restates
	// section.objectives[] (already shown in the header below). Suppress the visible duplicate
	// but keep its anchor addressable — see Block.svelte's `hidden` prop.
	function isRedundantObjectivesBlock(index: number): boolean {
		const block = data.section.blocks[index];
		return index === 0 && block?.heading === 'Learning Objectives' && data.section.objectives.length > 0;
	}

	// `trail` is the heading breadcrumb down to (and usually including) the block's own heading,
	// which the block's html already renders as an <h2>. Drop that last, duplicate segment and
	// only show the ancestor path — and only when it differs from the previous visible block's,
	// so a run of blocks under the same sub-heading doesn't repeat it.
	function ancestorBreadcrumb(index: number): string[] {
		const block = data.section.blocks[index];
		const trail =
			block.trail.length > 0 && block.trail[block.trail.length - 1] === block.heading
				? block.trail.slice(0, -1)
				: block.trail;
		const prev = index > 0 ? data.section.blocks[index - 1] : null;
		if (prev) {
			const prevTrail =
				prev.trail.length > 0 && prev.trail[prev.trail.length - 1] === prev.heading
					? prev.trail.slice(0, -1)
					: prev.trail;
			if (JSON.stringify(prevTrail) === JSON.stringify(trail)) return [];
		}
		return trail;
	}

	// Persist reading position (per book slug) whenever the visited section changes.
	$effect(() => {
		savePosition(data.slug, data.section.id);
	});

	// Deep links: /read/[sectionId]#<anchor> scrolls to and briefly highlights that block. Runs
	// after every navigation (not just mount) so in-page anchor links work on repeat visits too.
	afterNavigate(() => {
		const hash = window.location.hash.slice(1);
		if (!hash) return;
		const target = document.getElementById(hash);
		if (!target) return;
		target.scrollIntoView({ behavior: 'smooth', block: 'center' });
		target.classList.add('flash-highlight');
		setTimeout(() => target.classList.remove('flash-highlight'), 2000);
	});

</script>

<svelte:head>
	<title>{data.section.title} — {data.section.number ? `${data.section.number} · ` : ''}GenOER Reader</title>
</svelte:head>

<article class="section-content">
	<header class="section-header">
		{#if data.section.number}
			<span class="section-number">Section {data.section.number}</span>
		{/if}
		<h1 class="section-title">{data.section.title}</h1>
		{#if data.section.objectives.length > 0}
			<section class="section-objectives" aria-label="Learning objectives">
				<h2>Learning Objectives</h2>
				<p>By the end of this section, you will be able to:</p>
				<ul>
					{#each data.section.objectives as objective (objective)}
						<li>{objective}</li>
					{/each}
				</ul>
			</section>
		{/if}
	</header>

	{#each data.section.blocks as block, i (block.anchor)}
		<Block
			{block}
			mediaBase={media}
			hidden={isRedundantObjectivesBlock(i)}
			breadcrumb={ancestorBreadcrumb(i)}
		/>
	{/each}

	<SectionNav prev={data.prev} next={data.next} />
</article>
