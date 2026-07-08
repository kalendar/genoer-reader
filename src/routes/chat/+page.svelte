<script lang="ts">
	import ChatPanel from '$lib/components/ChatPanel.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Chat — {data.book.title} — GenOER Reader</title>
</svelte:head>

<ChatPanel book={data.book} graph={data.graph} slug={data.slug} />
