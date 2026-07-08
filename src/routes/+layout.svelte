<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();

	let pathname = $derived(page.url.pathname);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<header class="app-nav">
	<a class="app-nav-brand" href="/">GenOER Reader</a>
	<nav aria-label="Main">
		<a href="/read" aria-current={pathname.startsWith('/read') ? 'page' : undefined}>Read</a>
		<a href="/map" aria-current={pathname.startsWith('/map') ? 'page' : undefined}>Concept map</a>
		<a href="/chat" aria-current={pathname.startsWith('/chat') ? 'page' : undefined}>Chat</a>
		<a href="/pathways" aria-current={pathname.startsWith('/pathways') ? 'page' : undefined}>Pathways</a>
		<a href="/notebook" aria-current={pathname.startsWith('/notebook') ? 'page' : undefined}>Notebook</a>
	</nav>
</header>

{@render children()}
