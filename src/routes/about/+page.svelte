<script lang="ts">
	/**
	 * The 5R layer's centerpiece (SPEC.md §9): the full stack story, "view the
	 * data" global downloads, the "make your own" walkthrough, the 5Rs mapped
	 * to concrete in-app affordances, attribution for both the book and the
	 * app, and the "export everything" Retain action.
	 */
	import { currentBook, currentBookSource } from '$lib/stores/book';
	import { currentGraph } from '$lib/stores/graph';
	import { buildAttributionText, licenseCodes, hasRestrictiveTerms } from '$lib/utils/attribution';
	import { MODELS } from '$lib/models/registry';
	import { REPO_URL } from '$lib/utils/repo';
	import { exportAllData, importAllData, type ImportSummary } from '$lib/utils/export-all';
	import { bookUrl } from '$lib/data/book';
	import { graphUrl } from '$lib/data/graph';
	import { base } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Prefer whatever book is actually active this session (SPEC.md §8 load-your-own) — falls back
	// to the bundled reference book (this route's own `load`) on a cold visit to /about, or during
	// prerendering where the stores are unpopulated.
	let book = $derived($currentBook ?? data.book);
	let graph = $derived($currentGraph ?? data.graph);
	let source = $derived($currentBookSource ?? { kind: 'bundled' as const, slug: data.slug });
	let isBundled = $derived(source.kind === 'bundled');

	let attributionText = $derived(buildAttributionText(book));
	let codes = $derived(licenseCodes(book.license));
	let restrictive = $derived(hasRestrictiveTerms(book.license));

	const appAttributionText = `GenOER Reader — free software, no accounts, no analytics. Fork it: ${REPO_URL}`;

	let copiedBook = $state(false);
	let copiedApp = $state(false);
	async function copy(text: string, which: 'book' | 'app') {
		try {
			await navigator.clipboard.writeText(text);
			if (which === 'book') {
				copiedBook = true;
				setTimeout(() => (copiedBook = false), 1800);
			} else {
				copiedApp = true;
				setTimeout(() => (copiedApp = false), 1800);
			}
		} catch {
			/* clipboard unavailable — the text is still visible to select/copy manually */
		}
	}

	// Global "view/download the data" links (SPEC.md §9) — the bundled book is served as a static
	// file at a fixed path; a loaded-your-own book from a URL source downloads from its own host
	// directly (no need to re-fetch/re-serve it through this app).
	let bookJsonHref = $derived(
		source.kind === 'url' ? `${source.url}book.json` : source.kind === 'bundled' ? bookUrl(source.slug) : null
	);
	let graphJsonHref = $derived(
		source.kind === 'url' ? `${source.url}graph.json` : source.kind === 'bundled' ? graphUrl(source.slug) : null
	);

	// Export/import everything (SPEC.md §9 "Retain").
	let importMessage = $state<string | null>(null);
	let importError = $state<string | null>(null);
	let fileInput: HTMLInputElement | undefined = $state();

	async function handleImportAll(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		importMessage = null;
		importError = null;
		try {
			const r: ImportSummary = await importAllData(file);
			importMessage = `Imported from ${r.books} book${r.books === 1 ? '' : 's'}: ${r.highlights} highlight${r.highlights === 1 ? '' : 's'}, ${r.notes} note${r.notes === 1 ? '' : 's'}, ${r.chatTurns} chat turn${r.chatTurns === 1 ? '' : 's'}, ${r.practiceSessions} practice session${r.practiceSessions === 1 ? '' : 's'} (merged with what was already here).`;
		} catch (e) {
			importError = e instanceof Error ? e.message : String(e);
		} finally {
			input.value = '';
		}
	}
</script>

<svelte:head>
	<title>About &amp; the 5Rs — GenOER Reader</title>
</svelte:head>

<main class="about-page">
	<header class="about-hero">
		<h1>About GenOER Reader</h1>
		<p class="about-tagline">
			Every layer of this app — content, code, data, and model weights — is openly licensed, so
			you can exercise the 5Rs (<strong>Retain, Revise, Remix, Reuse, Redistribute</strong>) over
			the whole thing, not just the text. This page shows exactly how, with working links.
		</p>
	</header>

	<section class="about-section" aria-labelledby="content-heading">
		<h2 id="content-heading">The content, and its license</h2>
		<p>
			You're currently reading <strong>{book.title}</strong>, published by {book.publisher}, licensed
			<a href={book.license_url} rel="license noopener noreferrer" target="_blank">{book.license}</a
			>{#if isBundled}&nbsp;— the bundled reference book{/if}.
		</p>
		{#if restrictive}
			<p class="about-license-badges" aria-label="License terms">
				{#each codes as code (code)}<span class="license-badge">{code}</span>{/each}
				{#if codes.includes('NC')}
					<span class="about-license-note">NonCommercial — this content can't be used commercially without permission.</span>
				{/if}
				{#if codes.includes('SA')}
					<span class="about-license-note">ShareAlike — adaptations must carry the same license.</span>
				{/if}
			</p>
		{/if}
		<div class="about-copy-row">
			<code class="about-attribution-text">{attributionText}</code>
			<button type="button" onclick={() => copy(attributionText, 'book')}>{copiedBook ? 'Copied!' : 'Copy attribution'}</button>
		</div>
	</section>

	<section class="about-section" aria-labelledby="pipeline-heading">
		<h2 id="pipeline-heading">How the data was made</h2>
		<p>
			<code>book.json</code> is produced from the source OpenStax collection (CNXML/POET format) by
			<a href="https://github.com/kalendar/openstax-convert" rel="noopener noreferrer" target="_blank"
				>openstax-convert</a
			>
			— it parses every module into ordered, addressable content blocks, resolves figures and math,
			and folds figure alt text into block text so chat grounding works even when an image is
			missing.
		</p>
		<p>
			<code>graph.json</code> is derived from that same content by
			<a href="https://github.com/kalendar/openstax-graph" rel="noopener noreferrer" target="_blank"
				>openstax-graph</a
			>
			— a build-time pipeline that extracts a concept/entity vocabulary and a typed relationship
			graph (<code>is-a</code>, <code>part-of</code>, <code>depends-on</code>, <code>contrasts-with</code>,
			<code>related-to</code>, <code>illustrates</code>) using a frontier model, then
			<strong>adversarially verifies every semantic edge</strong> with a separate model pass before
			it ships — nothing in the map or the pathways feature is a raw, unchecked LLM claim.
		</p>
		<p class="about-verification-stat">
			On the bundled reference book, that pipeline produced <strong>611 nodes</strong> and
			<strong>2,036 edges</strong> — and all <strong>481 semantic edges were adversarially verified</strong>.
			Verified edges are badged <span class="verified-badge-inline">verified</span> throughout the
			concept map.
		</p>
		{#if graph}
			<p class="about-live-stats">
				This book's live graph: {graph.data.nodes.concepts.length} concepts,
				{graph.data.nodes.entities.length} entities, {graph.data.edges.length} edges.
			</p>
		{/if}
	</section>

	<section class="about-section" aria-labelledby="model-heading">
		<h2 id="model-heading">The model, and the engine running it</h2>
		<p>
			Chat and practice questions run entirely on-device via
			<a href="https://huggingface.co/docs/transformers.js" rel="noopener noreferrer" target="_blank"
				>Transformers.js</a
			>
			(Apache-2.0) — no server, no API key, nothing you type leaves your browser. The default model
			list is Qwen3 (Apache-2.0), in tiers sized for different hardware:
		</p>
		<ul class="about-model-list">
			{#each MODELS as m (m.id)}
				<li><strong>{m.name}</strong> ({m.params}, {m.license}) — {m.blurb}</li>
			{/each}
		</ul>
		<p>
			An advanced setting lets you point the engine at any ONNX model on the Hugging Face Hub — the
			model layer is itself remixable (verify the license yourself before using a non-default one).
		</p>
	</section>

	<section class="about-section" aria-labelledby="view-data-heading">
		<h2 id="view-data-heading">View the data</h2>
		<p>
			Every reader section offers "view this section's JSON"; every concept-map node/edge detail
			offers "view JSON". Here are the whole files for the book currently open:
		</p>
		<ul class="about-download-list">
			<li>
				{#if bookJsonHref}<a href={bookJsonHref} target="_blank" rel="noopener noreferrer">Download book.json</a
					>{:else}<span class="about-download-unavailable"
						>book.json isn't downloadable this way for a locally loaded file — it's already on
						your disk.</span
					>{/if}
			</li>
			<li>
				{#if graph && graphJsonHref}<a href={graphJsonHref} target="_blank" rel="noopener noreferrer"
						>Download graph.json</a
					>{:else if graph}<span class="about-download-unavailable"
						>graph.json isn't downloadable this way for a locally loaded file — it's already on
						your disk.</span
					>{:else}<span class="about-download-unavailable">This book has no graph.json.</span>{/if}
			</li>
		</ul>
	</section>

	<section class="about-section" aria-labelledby="make-your-own-heading">
		<h2 id="make-your-own-heading">Make your own</h2>
		<ol class="about-steps">
			<li>
				Pick any OpenStax book repo (an <code>osbooks-*</code> GitHub repo) and run
				<code>openstax-convert</code> on it to get <code>book.json</code> + <code>media/</code>.
			</li>
			<li>
				Optionally run <code>openstax-graph</code> on the result to get an adversarially-verified
				<code>graph.json</code> — the map, pathways, and concept highlighting only need this step;
				the reader and chat work fine without it (page-grounded instead of graph-grounded).
			</li>
			<li>
				Host the output directory (<code>book.json</code>, optional <code>graph.json</code>, and
				<code>media/</code>) anywhere static — GitHub Pages, a bucket, a personal site.
			</li>
			<li>
				Open this app with <code>?book=</code> followed by that directory's URL — e.g.
				<code>https://genoer-reader.example/read?book=https://example.com/my-book/</code> — or use
				the loader on the <a href="{base}/">landing page</a>, which also accepts a dropped
				<code>book.json</code> file directly (no hosting needed, processed entirely in your
				browser).
			</li>
		</ol>
	</section>

	<section class="about-section" aria-labelledby="fiveRs-heading">
		<h2 id="fiveRs-heading">The 5Rs, concretely</h2>
		<dl class="about-5r-list">
			<div class="about-5r-item">
				<dt>Retain</dt>
				<dd>
					Every highlight, note, chat transcript, practice session, reading position, and setting
					you make here is local to your browser and exportable as one JSON file any time — see
					<a href="{base}/notebook">the notebook</a> or the button below.
				</dd>
			</div>
			<div class="about-5r-item">
				<dt>Revise</dt>
				<dd>
					<code>book.json</code>/<code>graph.json</code> are plain, documented data — edit them, run
					the pipelines on a different edition, or hand-correct a concept definition, then load your
					version straight back in with <code>?book=</code>.
				</dd>
			</div>
			<div class="about-5r-item">
				<dt>Remix</dt>
				<dd>
					Swap the model (any ONNX repo on the Hub), point the map/pathways at a different book's
					graph, or recombine sections — the app renders whatever shape of <code>book.json</code>/<code
						>graph.json</code
					> you give it.
				</dd>
			</div>
			<div class="about-5r-item">
				<dt>Reuse</dt>
				<dd>
					The whole app is a static site — clone the repo, run it locally, or deploy your own copy
					to any static host at zero cost.
				</dd>
			</div>
			<div class="about-5r-item">
				<dt>Redistribute</dt>
				<dd>
					<a href={REPO_URL} rel="noopener noreferrer" target="_blank">Fork it on GitHub</a>, change
					what you like (the code is MIT-licensed), and ship your own version — "fork, enable
					Pages" is the whole deploy story.
				</dd>
			</div>
		</dl>
	</section>

	<section class="about-section" aria-labelledby="retain-heading">
		<h2 id="retain-heading">Export everything</h2>
		<p>
			One file with every highlight, note, chat transcript, practice session, reading position, and
			setting from every book you've opened in this browser. Import merges non-destructively — it
			never overwrites or deletes anything already here.
		</p>
		<div class="about-export-actions">
			<button type="button" onclick={exportAllData}>Export everything (JSON)</button>
			<button type="button" onclick={() => fileInput?.click()}>Import from a file</button>
			<input
				bind:this={fileInput}
				type="file"
				accept="application/json"
				class="about-file-input"
				onchange={handleImportAll}
			/>
		</div>
		{#if importMessage}<p class="about-import-ok" role="status">{importMessage}</p>{/if}
		{#if importError}<p class="about-import-err" role="alert">{importError}</p>{/if}
	</section>

	<section class="about-section" aria-labelledby="app-attribution-heading">
		<h2 id="app-attribution-heading">Attribution &amp; privacy</h2>
		<div class="about-copy-row">
			<code class="about-attribution-text">{appAttributionText}</code>
			<button type="button" onclick={() => copy(appAttributionText, 'app')}>{copiedApp ? 'Copied!' : 'Copy'}</button>
		</div>
		<p class="about-privacy">
			No analytics, no telemetry, no cookies, no accounts. The only network calls this app makes
			after loading are fetching the book you point it at and fetching model weights from Hugging
			Face's public CDN — both cached for offline use afterward.
		</p>
	</section>
</main>

<style>
	.about-page {
		max-width: 44rem;
		margin: 0 auto;
		padding: var(--space-2) var(--space-2) var(--space-4);
		font-family: var(--font-ui);
	}

	.about-hero h1 {
		font-family: var(--font-reading);
		font-size: 2rem;
		margin: var(--space-2) 0 0.5rem;
	}
	.about-tagline {
		color: var(--color-text-muted);
		font-size: 1.02rem;
	}

	.about-section {
		margin-top: var(--space-4);
		padding-top: var(--space-3);
		border-top: 1px solid var(--color-border);
	}
	.about-section h2 {
		font-family: var(--font-reading);
		font-size: 1.35rem;
		margin: 0 0 var(--space-2);
	}
	.about-section p,
	.about-section li {
		line-height: 1.6;
	}
	.about-section code {
		background: var(--color-bg-raised);
		border: 1px solid var(--color-border);
		border-radius: 0.2rem;
		padding: 0.05rem 0.3rem;
		font-size: 0.88em;
	}

	.about-license-badges {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin: 0.5rem 0;
	}
	.license-badge {
		display: inline-block;
		font-size: 0.7rem;
		font-weight: 700;
		padding: 0.05rem 0.35rem;
		border-radius: 0.2rem;
		background: var(--color-accent);
		color: var(--color-accent-contrast);
	}
	.about-license-note {
		font-size: 0.82rem;
		color: var(--color-text-muted);
	}

	.about-copy-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
		background: var(--color-bg-raised);
		border: 1px solid var(--color-border);
		border-radius: 0.4rem;
		padding: 0.6rem 0.8rem;
	}
	.about-attribution-text {
		flex: 1 1 auto;
		background: none;
		border: none;
		padding: 0;
		font-size: 0.85rem;
	}
	.about-copy-row button,
	.about-export-actions button {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.3rem;
		padding: 0.4rem 0.8rem;
		cursor: pointer;
		color: var(--color-text);
		font-size: 0.82rem;
		white-space: nowrap;
	}
	.about-copy-row button:hover,
	.about-export-actions button:hover {
		border-color: var(--color-accent);
	}

	.about-verification-stat {
		background: var(--color-bg-raised);
		border-left: 3px solid var(--color-accent);
		border-radius: 0 0.3rem 0.3rem 0;
		padding: 0.6rem 0.9rem;
	}
	.verified-badge-inline {
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-accent);
		border: 1px solid var(--color-accent);
		border-radius: 0.2rem;
		padding: 0.02rem 0.28rem;
	}
	.about-live-stats {
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.about-model-list {
		padding-left: 1.2rem;
	}

	.about-download-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.about-download-unavailable {
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}

	.about-steps {
		padding-left: 1.3rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.about-5r-list {
		margin: 0;
	}
	.about-5r-item {
		margin-bottom: var(--space-2);
	}
	.about-5r-item dt {
		font-family: var(--font-reading);
		font-weight: 700;
		font-size: 1.05rem;
		color: var(--color-accent);
	}
	.about-5r-item dd {
		margin: 0.2rem 0 0;
	}

	.about-export-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.about-file-input {
		display: none;
	}
	.about-import-ok {
		color: #2e7d32;
		font-size: 0.85rem;
	}
	.about-import-err {
		color: #a12a2a;
		font-size: 0.85rem;
	}

	.about-privacy {
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}
</style>
