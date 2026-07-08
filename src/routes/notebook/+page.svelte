<script lang="ts">
	/**
	 * Notebook (SPEC.md §7 "Highlights & notes" — "a notebook view listing all
	 * highlights/notes with deep links; export AND import as a single JSON
	 * file"). Also the natural home for the "Retain" story (SPEC.md §9): every
	 * highlight and note the reader has made, in one place, portable as JSON
	 * independent of the app.
	 */
	import { onMount } from 'svelte';
	import {
		highlights,
		notes,
		initAnnotations,
		removeHighlight,
		removeNote,
		updateNote,
		exportAnnotations,
		importAnnotations,
		clearAnnotations
	} from '$lib/stores/highlights';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	onMount(() => initAnnotations(data.slug));

	let editingNoteId = $state<string | null>(null);
	let draft = $state('');
	let importMessage = $state<string | null>(null);
	let importError = $state<string | null>(null);
	let fileInput: HTMLInputElement | undefined = $state();

	// Highlights, most recent first, each paired with its attached note (if any).
	let highlightRows = $derived(
		[...$highlights]
			.sort((a, b) => b.createdAt - a.createdAt)
			.map((h) => ({ highlight: h, note: $notes.find((n) => n.highlightId === h.id) }))
	);

	// Whole-block notes, most recent first.
	let blockNotes = $derived(
		[...$notes].filter((n) => n.highlightId === null).sort((a, b) => b.createdAt - a.createdAt)
	);

	function startEdit(note: { id: string; text: string }) {
		editingNoteId = note.id;
		draft = note.text;
	}

	function saveEdit(id: string) {
		const text = draft.trim();
		if (text) updateNote(data.slug, id, text);
		else removeNote(data.slug, id);
		editingNoteId = null;
	}

	async function handleImport(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		importMessage = null;
		importError = null;
		try {
			const result = await importAnnotations(data.slug, file);
			importMessage = `Imported ${result.highlights} highlight${result.highlights === 1 ? '' : 's'} and ${result.notes} note${result.notes === 1 ? '' : 's'} (merged with what was already here).`;
		} catch (e) {
			importError = e instanceof Error ? e.message : String(e);
		} finally {
			input.value = '';
		}
	}

	function handleClear() {
		if (!confirm('Delete every highlight and note in this notebook? This can\'t be undone — export first if you want a copy.')) return;
		clearAnnotations(data.slug);
	}
</script>

<svelte:head>
	<title>Notebook — GenOER Reader</title>
</svelte:head>

<div class="notebook-page">
	<header class="notebook-header">
		<div>
			<h1>Notebook</h1>
			<p class="notebook-intro">
				Every highlight and note you've made, stored only in this browser. Export them as a
				single JSON file any time — your annotations are yours to keep, independent of this app.
				Want chat history and practice sessions too? See <a href="/about#retain-heading">Export
				everything</a> on the About page.
			</p>
		</div>
		<div class="notebook-actions">
			<button type="button" onclick={() => exportAnnotations(data.slug)}>Export JSON</button>
			<button type="button" onclick={() => fileInput?.click()}>Import JSON</button>
			<input
				bind:this={fileInput}
				type="file"
				accept="application/json"
				class="notebook-file-input"
				onchange={handleImport}
			/>
			<button type="button" class="notebook-clear" onclick={handleClear}>Clear all</button>
		</div>
	</header>

	{#if importMessage}<p class="notebook-import-ok">{importMessage}</p>{/if}
	{#if importError}<p class="notebook-import-err">{importError}</p>{/if}

	<section class="notebook-section">
		<h2>Highlights <span class="notebook-count">{highlightRows.length}</span></h2>
		{#if highlightRows.length === 0}
			<p class="notebook-empty">
				No highlights yet — select text in the reader and choose "Highlight" from the toolbar
				that appears.
			</p>
		{:else}
			<ul class="notebook-list">
				{#each highlightRows as { highlight, note } (highlight.id)}
					<li class="notebook-item">
						<blockquote class="notebook-quote">&ldquo;{highlight.text}&rdquo;</blockquote>
						<div class="notebook-meta">
							<a href="/read/{highlight.sectionId}#{highlight.anchor}">
								{highlight.sectionNumber ? `§${highlight.sectionNumber} ` : ''}{highlight.sectionTitle}
							</a>
							<span class="notebook-date">{new Date(highlight.createdAt).toLocaleDateString()}</span>
						</div>
						{#if editingNoteId === note?.id}
							<textarea class="highlight-card-note-input" bind:value={draft} rows="3"></textarea>
							<div class="highlight-card-actions">
								<button type="button" class="highlight-card-save" onclick={() => saveEdit(note!.id)}>Save</button>
								<button type="button" class="highlight-card-cancel" onclick={() => (editingNoteId = null)}
									>Cancel</button
								>
							</div>
						{:else if note}
							<p class="notebook-note-text">{note.text}</p>
							<div class="highlight-card-actions">
								<button type="button" class="highlight-card-save" onclick={() => startEdit(note)}>Edit note</button>
								<button type="button" class="highlight-card-cancel" onclick={() => removeNote(data.slug, note.id)}
									>Delete note</button
								>
							</div>
						{/if}
						<button type="button" class="notebook-remove" onclick={() => removeHighlight(data.slug, highlight.id)}>
							Remove highlight
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="notebook-section">
		<h2>Notes on paragraphs <span class="notebook-count">{blockNotes.length}</span></h2>
		{#if blockNotes.length === 0}
			<p class="notebook-empty">
				No whole-paragraph notes yet — use the "+ note" button that appears next to a paragraph
				in the reader.
			</p>
		{:else}
			<ul class="notebook-list">
				{#each blockNotes as note (note.id)}
					<li class="notebook-item">
						<div class="notebook-meta">
							<a href="/read/{note.sectionId}#{note.blockAnchor}">
								{note.sectionNumber ? `§${note.sectionNumber} ` : ''}{note.sectionTitle}
							</a>
							<span class="notebook-date">{new Date(note.createdAt).toLocaleDateString()}</span>
						</div>
						{#if editingNoteId === note.id}
							<textarea class="highlight-card-note-input" bind:value={draft} rows="3"></textarea>
							<div class="highlight-card-actions">
								<button type="button" class="highlight-card-save" onclick={() => saveEdit(note.id)}>Save</button>
								<button type="button" class="highlight-card-cancel" onclick={() => (editingNoteId = null)}
									>Cancel</button
								>
							</div>
						{:else}
							<p class="notebook-note-text">{note.text}</p>
							<div class="highlight-card-actions">
								<button type="button" class="highlight-card-save" onclick={() => startEdit(note)}>Edit</button>
								<button type="button" class="highlight-card-cancel" onclick={() => removeNote(data.slug, note.id)}
									>Delete</button
								>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<style>
	.notebook-page {
		max-width: var(--measure);
		margin: 0 auto;
		padding: var(--space-2) var(--space-2) var(--space-4);
		font-family: var(--font-ui);
	}

	.notebook-header {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--space-2);
	}

	.notebook-header h1 {
		font-size: 1.6rem;
		margin: 0 0 0.4rem;
	}

	.notebook-intro {
		color: var(--color-text-muted);
		max-width: 34rem;
	}

	.notebook-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.notebook-actions button {
		background: var(--color-bg-raised);
		border: 1px solid var(--color-border);
		border-radius: 0.3rem;
		padding: 0.45rem 0.8rem;
		cursor: pointer;
		color: var(--color-text);
		font-size: 0.85rem;
	}

	.notebook-actions button:hover {
		border-color: var(--color-accent);
	}

	.notebook-clear {
		color: #a12a2a;
	}

	.notebook-file-input {
		display: none;
	}

	.notebook-import-ok {
		color: #2e7d32;
		font-size: 0.85rem;
	}

	.notebook-import-err {
		color: #a12a2a;
		font-size: 0.85rem;
	}

	.notebook-section {
		margin-top: var(--space-4);
	}

	.notebook-section h2 {
		font-size: 1.15rem;
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}

	.notebook-count {
		font-size: 0.78rem;
		font-weight: 400;
		color: var(--color-text-muted);
	}

	.notebook-empty {
		color: var(--color-text-muted);
	}

	.notebook-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.notebook-item {
		border: 1px solid var(--color-border);
		border-radius: 0.4rem;
		padding: var(--space-2);
		background: var(--color-bg-raised);
	}

	.notebook-quote {
		margin: 0 0 0.4rem;
		padding-left: 0.6rem;
		border-left: 3px solid var(--color-accent);
		font-style: italic;
	}

	.notebook-meta {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
		font-size: 0.8rem;
		margin-bottom: 0.4rem;
	}

	.notebook-date {
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.notebook-note-text {
		margin: 0 0 0.4rem;
		white-space: pre-wrap;
	}

	.notebook-remove {
		background: none;
		border: none;
		padding: 0;
		color: var(--color-text-muted);
		font-size: 0.78rem;
		cursor: pointer;
		text-decoration: underline;
		margin-top: 0.3rem;
	}

	.notebook-remove:hover {
		color: #a12a2a;
	}
</style>
