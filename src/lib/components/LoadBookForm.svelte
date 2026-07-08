<script lang="ts">
	/**
	 * Landing-page "load your own book" UI (SPEC.md §8).
	 *
	 * Two independent ways in, both funneling through the same
	 * `resolveActiveBook` resolver the routes use (so validation and
	 * degradation behave identically to visiting a `?book=` link directly):
	 *  - a URL to a directory containing book.json (+ optional graph.json,
	 *    media/) on any static host;
	 *  - a dropped/picked book.json (+ optional graph.json), validated and
	 *    persisted to IndexedDB entirely in-browser (no network at all).
	 *
	 * Errors are surfaced inline, specific and human-readable (SPEC.md §8) —
	 * nothing here ever navigates to a broken route on failure.
	 */
	import { goto } from '$app/navigation';
	import { resolveActiveBook, BookLoadError } from '$lib/data/resolve-book';
	import { validateBook, DEFAULT_BOOK_SLUG, type Book } from '$lib/data/book';
	import { validateGraph } from '$lib/data/graph';
	import { putLocalBook } from '$lib/data/local-db';
	import { registerBookSource, listRegisteredSources, slugify, unregisterBookSource } from '$lib/data/book-source';
	import { deleteLocalBook } from '$lib/data/local-db';

	let mode = $state<'url' | 'file'>('url');

	// ---- URL loading ----------------------------------------------------------
	let urlInput = $state('');
	let urlLoading = $state(false);
	let urlError = $state<string | null>(null);

	async function submitUrl(e: Event) {
		e.preventDefault();
		const value = urlInput.trim();
		if (!value) return;
		urlError = null;
		urlLoading = true;
		try {
			const resolved = await resolveActiveBook({ fetch, bookParam: value });
			await goto(`/read?book=${encodeURIComponent(value)}`);
			void resolved; // resolveActiveBook already registered the source; nothing else to do
		} catch (err) {
			urlError = err instanceof BookLoadError || err instanceof Error ? err.message : String(err);
		} finally {
			urlLoading = false;
		}
	}

	// ---- Local file loading -----------------------------------------------
	let bookFile = $state<File | null>(null);
	let graphFile = $state<File | null>(null);
	let parsedBook = $state<Book | null>(null);
	let slugField = $state('');
	let fileError = $state<string | null>(null);
	let fileLoading = $state(false);
	let dragOver = $state(false);

	async function handleFiles(files: FileList | File[]) {
		fileError = null;
		parsedBook = null;
		const list = Array.from(files);
		const book = list.find((f) => /book\.json$/i.test(f.name)) ?? list.find((f) => f.type === 'application/json' && list.length === 1);
		const graph = list.find((f) => /graph\.json$/i.test(f.name));
		if (!book) {
			fileError = list.length > 0 ? 'Couldn\'t find a "book.json" among the dropped files.' : null;
			return;
		}
		bookFile = book;
		graphFile = graph ?? null;
		try {
			const text = await book.text();
			const data: unknown = JSON.parse(text);
			validateBook(data, book.name);
			parsedBook = data as Book;
			slugField = data && typeof data === 'object' && 'slug' in data ? String((data as Book).slug) : slugify(book.name);
			if (graphFile) {
				const graphText = await graphFile.text();
				const graphData: unknown = JSON.parse(graphText);
				validateGraph(graphData, book.name);
			}
		} catch (err) {
			parsedBook = null;
			fileError = err instanceof Error ? err.message : String(err);
		}
	}

	function onFileInputChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		if (input.files && input.files.length > 0) void handleFiles(input.files);
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) void handleFiles(e.dataTransfer.files);
	}

	let recentSources = $state(listRegisteredSources());
	const existingSlugs = $derived(new Set(recentSources.map((s) => s.slug)));
	const slugTaken = $derived(slugField.trim().length > 0 && existingSlugs.has(slugField.trim()) && slugField.trim() !== parsedBook?.slug);
	const slugValid = $derived(/^[a-z0-9][a-z0-9-]*$/i.test(slugField.trim()));

	async function submitFile(e: Event) {
		e.preventDefault();
		if (!parsedBook || !bookFile) return;
		const slug = slugField.trim();
		if (!slugValid) {
			fileError = 'Slug must start with a letter or number and contain only letters, numbers, and hyphens.';
			return;
		}
		fileError = null;
		fileLoading = true;
		try {
			const bookJson = await bookFile.text();
			const graphJson = graphFile ? await graphFile.text() : null;
			await putLocalBook({
				slug,
				bookJson,
				graphJson,
				sourceLabel: graphFile ? `${bookFile.name} + ${graphFile.name}` : bookFile.name,
				savedAt: Date.now()
			});
			registerBookSource(slug, 'local', { label: parsedBook.title });
			await goto(`/read?book=local:${encodeURIComponent(slug)}`);
		} catch (err) {
			fileError = err instanceof Error ? err.message : String(err);
		} finally {
			fileLoading = false;
		}
	}

	function forgetSource(slug: string) {
		unregisterBookSource(slug);
		void deleteLocalBook(slug); // no-op if it wasn't a local source
		recentSources = listRegisteredSources();
	}
</script>

<div class="load-book-form">
	<div class="load-book-tabs" role="tablist" aria-label="Load a book">
		<button type="button" role="tab" aria-selected={mode === 'url'} onclick={() => (mode = 'url')}>
			From a URL
		</button>
		<button type="button" role="tab" aria-selected={mode === 'file'} onclick={() => (mode = 'file')}>
			From a file
		</button>
	</div>

	{#if mode === 'url'}
		<form onsubmit={submitUrl} class="load-book-panel">
			<label for="book-url">
				URL of a directory containing <code>book.json</code>
				<span class="load-book-hint">(optionally <code>graph.json</code>, <code>media/</code>) on any static host</span>
			</label>
			<div class="load-book-row">
				<input
					id="book-url"
					type="url"
					inputmode="url"
					placeholder="https://example.com/my-book/"
					bind:value={urlInput}
					required
				/>
				<button type="submit" disabled={urlLoading || !urlInput.trim()}>
					{urlLoading ? 'Loading…' : 'Load'}
				</button>
			</div>
			{#if urlError}<p class="load-book-error" role="alert">{urlError}</p>{/if}
		</form>
	{:else}
		<form onsubmit={submitFile} class="load-book-panel">
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="load-book-drop"
				class:dragover={dragOver}
				ondragover={(e) => {
					e.preventDefault();
					dragOver = true;
				}}
				ondragleave={() => (dragOver = false)}
				ondrop={onDrop}
			>
				<p>Drop <code>book.json</code> (and optionally <code>graph.json</code>) here, or</p>
				<label class="load-book-picker">
					Choose files
					<input type="file" accept="application/json,.json" multiple onchange={onFileInputChange} class="sr-only-input" />
				</label>
				<p class="load-book-hint">
					Processed entirely in this browser — nothing is uploaded anywhere. Media isn't included
					in local loads, so figures will show as missing; use the URL loader for a book with images.
				</p>
			</div>

			{#if parsedBook}
				<div class="load-book-preview">
					<p>
						<strong>{parsedBook.title}</strong> by {parsedBook.publisher} — {parsedBook.sections.length} section{parsedBook.sections.length === 1 ? '' : 's'}
						{#if graphFile}· with graph.json{/if}
					</p>
					<label for="local-slug">
						Book slug (identifies this book's saved highlights/notes/chat — must be unique)
					</label>
					<input id="local-slug" type="text" bind:value={slugField} required />
					{#if slugTaken}
						<p class="load-book-warn">
							"{slugField}" is already used by another loaded book — its highlights/notes/chat would
							be shared with this one. Pick a different slug to keep them separate.
						</p>
					{/if}
					<button type="submit" disabled={fileLoading || !slugValid}>
						{fileLoading ? 'Saving…' : 'Load this book'}
					</button>
				</div>
			{/if}
			{#if fileError}<p class="load-book-error" role="alert">{fileError}</p>{/if}
		</form>
	{/if}

	{#if recentSources.length > 0}
		<div class="load-book-recent">
			<h2>Previously loaded books</h2>
			<ul>
				{#each recentSources as entry (entry.slug)}
					<li>
						<a href="/read?book={encodeURIComponent(entry.kind === 'local' ? `local:${entry.slug}` : (entry.url ?? entry.slug))}">
							{entry.label}
						</a>
						<span class="load-book-recent-kind">{entry.kind === 'local' ? 'local file' : 'URL'}</span>
						<button type="button" class="load-book-forget" onclick={() => forgetSource(entry.slug)}>Forget</button>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<p class="load-book-bundled">
		Or just <a href="/read?book={DEFAULT_BOOK_SLUG}">read the bundled reference book</a> — no setup required.
	</p>
</div>

<style>
	.load-book-form {
		font-family: var(--font-ui);
		max-width: 34rem;
	}

	.load-book-tabs {
		display: flex;
		border: 1px solid var(--color-border);
		border-radius: 0.3rem;
		overflow: hidden;
		margin-bottom: var(--space-2);
		width: fit-content;
	}
	.load-book-tabs button {
		background: var(--color-bg-raised);
		border: none;
		padding: 0.5rem 1rem;
		cursor: pointer;
		color: var(--color-text);
		border-right: 1px solid var(--color-border);
		font-size: 0.88rem;
	}
	.load-book-tabs button:last-child {
		border-right: none;
	}
	.load-book-tabs button[aria-selected='true'] {
		background: var(--color-accent);
		color: var(--color-accent-contrast);
	}

	.load-book-panel label {
		display: block;
		font-size: 0.85rem;
		margin-bottom: 0.4rem;
	}
	.load-book-hint {
		display: block;
		color: var(--color-text-muted);
		font-size: 0.78rem;
		margin-top: 0.15rem;
	}

	.load-book-row {
		display: flex;
		gap: 0.5rem;
	}
	.load-book-row input {
		flex: 1 1 auto;
		padding: 0.5rem 0.7rem;
		border: 1px solid var(--color-border);
		border-radius: 0.3rem;
		background: var(--color-bg-raised);
		color: var(--color-text);
		font-family: var(--font-ui);
	}

	.load-book-panel button[type='submit'] {
		background: var(--color-accent);
		color: var(--color-accent-contrast);
		border: none;
		border-radius: 0.3rem;
		padding: 0.5rem 1rem;
		cursor: pointer;
		font-size: 0.88rem;
	}
	.load-book-panel button[type='submit']:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.load-book-drop {
		border: 2px dashed var(--color-border);
		border-radius: 0.4rem;
		padding: var(--space-3);
		text-align: center;
		color: var(--color-text-muted);
	}
	.load-book-drop.dragover {
		border-color: var(--color-accent);
		background: var(--color-bg-raised);
	}
	.load-book-drop code {
		color: var(--color-text);
	}

	.load-book-picker {
		display: inline-block;
		margin: 0.4rem 0;
		padding: 0.45rem 0.9rem;
		background: var(--color-bg-raised);
		border: 1px solid var(--color-border);
		border-radius: 0.3rem;
		cursor: pointer;
		color: var(--color-text);
		font-size: 0.85rem;
	}
	.load-book-picker:hover,
	.load-book-picker:focus-within {
		border-color: var(--color-accent);
	}
	.sr-only-input {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}

	.load-book-preview {
		margin-top: var(--space-2);
		padding: var(--space-2);
		background: var(--color-bg-raised);
		border: 1px solid var(--color-border);
		border-radius: 0.4rem;
	}
	.load-book-preview input {
		width: 100%;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--color-border);
		border-radius: 0.3rem;
		background: var(--color-bg);
		color: var(--color-text);
		margin-bottom: 0.5rem;
		font-family: var(--font-ui);
	}

	.load-book-error {
		margin-top: 0.5rem;
		color: #a12a2a;
		font-size: 0.85rem;
	}
	.load-book-warn {
		color: var(--color-warn-text);
		font-size: 0.82rem;
	}

	.load-book-recent {
		margin-top: var(--space-3);
	}
	.load-book-recent h2 {
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		margin: 0 0 0.4rem;
	}
	.load-book-recent ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.load-book-recent li {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		font-size: 0.88rem;
	}
	.load-book-recent-kind {
		font-size: 0.72rem;
		color: var(--color-text-muted);
	}
	.load-book-forget {
		margin-left: auto;
		background: none;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: 0.78rem;
		text-decoration: underline;
	}

	.load-book-bundled {
		margin-top: var(--space-3);
		font-size: 0.88rem;
		color: var(--color-text-muted);
	}
</style>
