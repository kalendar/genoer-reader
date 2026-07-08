<script lang="ts">
	/**
	 * "View the data" affordance (SPEC.md §9 "View the data": "every reader page
	 * offers 'view this section's JSON'; the map offers 'view this node/edge'").
	 * A plain, collapsed-by-default `<details>` so it never competes visually
	 * with the reading/map content — the raw JSON is one click away, not
	 * shown by default.
	 */
	let {
		data,
		label = 'View JSON',
		filename = 'data.json'
	}: { data: unknown; label?: string; filename?: string } = $props();

	let copied = $state(false);
	let copyTimeout: ReturnType<typeof setTimeout> | undefined;
	const json = $derived(JSON.stringify(data, null, 2));

	async function copy() {
		try {
			await navigator.clipboard.writeText(json);
			copied = true;
			clearTimeout(copyTimeout);
			copyTimeout = setTimeout(() => (copied = false), 1800);
		} catch {
			/* clipboard unavailable/denied — the Download button still works */
		}
	}

	function download() {
		const blob = new Blob([json], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

<details class="json-viewer">
	<summary>{label}</summary>
	<div class="json-viewer-actions">
		<button type="button" onclick={copy}>{copied ? 'Copied!' : 'Copy'}</button>
		<button type="button" onclick={download}>Download</button>
	</div>
	<pre class="json-viewer-pre"><code>{json}</code></pre>
</details>

<style>
	.json-viewer {
		font-family: var(--font-ui);
		font-size: 0.82rem;
		margin: var(--space-2) 0;
	}
	.json-viewer summary {
		cursor: pointer;
		color: var(--color-text-muted);
		font-weight: 600;
	}
	.json-viewer-actions {
		display: flex;
		gap: 0.4rem;
		margin: 0.5rem 0;
	}
	.json-viewer-actions button {
		background: var(--color-bg-raised);
		border: 1px solid var(--color-border);
		border-radius: 0.3rem;
		padding: 0.3rem 0.7rem;
		cursor: pointer;
		color: var(--color-text);
		font-size: 0.78rem;
	}
	.json-viewer-actions button:hover {
		border-color: var(--color-accent);
	}
	.json-viewer-pre {
		max-height: 24rem;
		overflow: auto;
		background: var(--color-bg-raised);
		border: 1px solid var(--color-border);
		border-radius: 0.3rem;
		padding: var(--space-2);
		white-space: pre-wrap;
		word-break: break-word;
	}
</style>
