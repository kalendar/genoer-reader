<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import favicon from '$lib/assets/favicon.svg';
	import { registerServiceWorker } from '$lib/utils/storage';
	import { REPO_URL } from '$lib/utils/repo';
	import { bookQuerySuffix } from '$lib/utils/book-link';
	import { base } from '$app/paths';

	let { children } = $props();

	let pathname = $derived(page.url.pathname);
	// Keeps the top nav (and every other cross-view link — see $lib/utils/book-link) pointed at
	// whichever book is currently open (SPEC.md §8) instead of silently dropping back to the
	// bundled default the moment you leave the page that set `?book=`.
	let navSuffix = $derived(bookQuerySuffix());

	// Published as `--app-nav-h` so any route can size itself against the
	// nav's actual rendered height (it wraps to two lines on narrow
	// viewports, so a hardcoded value would drift) — used by /chat to make
	// its layout exactly fill the remaining viewport height (see chat's
	// `.chat` rule in ChatPanel.svelte).
	let navEl: HTMLElement | undefined = $state();

	onMount(() => {
		void registerServiceWorker();

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

	// /chat fills exactly the viewport height left after the nav (see ChatPanel.svelte's `.chat`
	// rule) and scrolls internally — a global footer below it would either get clipped or force a
	// second, confusing outer scrollbar, so it's the one route that opts out.
	let showGlobalFooter = $derived(!pathname.startsWith('/chat'));
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<a href="#app-main" class="skip-link">Skip to content</a>

<header class="app-nav" bind:this={navEl}>
	<a class="app-nav-brand" href="{base}/">GenOER Reader</a>
	<nav aria-label="Main">
		<a href="{base}/read{navSuffix}" aria-current={pathname.startsWith('/read') ? 'page' : undefined}>Read</a>
		<a href="{base}/map{navSuffix}" aria-current={pathname.startsWith('/map') ? 'page' : undefined}>Concept map</a>
		<a href="{base}/chat{navSuffix}" aria-current={pathname.startsWith('/chat') ? 'page' : undefined}>Chat</a>
		<a href="{base}/pathways{navSuffix}" aria-current={pathname.startsWith('/pathways') ? 'page' : undefined}>Pathways</a>
		<a href="{base}/notebook{navSuffix}" aria-current={pathname.startsWith('/notebook') ? 'page' : undefined}>Notebook</a>
		<a href="{base}/about" aria-current={pathname === '/about' ? 'page' : undefined}>About</a>
	</nav>
</header>

<div id="app-main" tabindex="-1">
	{@render children()}
</div>

{#if showGlobalFooter}
	<footer class="global-footer">
		<p>
			GenOER Reader is free software and free to use — no accounts, no analytics, nothing leaves
			your browser except fetching book/model files.
			<a href={REPO_URL} rel="noopener noreferrer" target="_blank">Fork it on GitHub</a>
			&middot; <a href="{base}/about">About &amp; the 5Rs</a>
		</p>
	</footer>
{/if}
