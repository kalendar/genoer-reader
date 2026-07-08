<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();

	let pathname = $derived(page.url.pathname);

	// Published as `--app-nav-h` so any route can size itself against the
	// nav's actual rendered height (it wraps to two lines on narrow
	// viewports, so a hardcoded value would drift) — used by /chat to make
	// its layout exactly fill the remaining viewport height (see chat's
	// `.chat` rule in ChatPanel.svelte).
	let navEl: HTMLElement | undefined = $state();

	onMount(() => {
		if (!navEl || typeof ResizeObserver === 'undefined') return;
		const el = navEl;
		const setNavHeight = () => {
			document.documentElement.style.setProperty('--app-nav-h', `${el.offsetHeight}px`);
		};
		setNavHeight();
		const ro = new ResizeObserver(setNavHeight);
		ro.observe(el);
		return () => ro.disconnect();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<header class="app-nav" bind:this={navEl}>
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
