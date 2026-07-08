<script lang="ts">
	/**
	 * Model settings panel (SPEC.md §5 "Models" + "Adaptive model selection").
	 *
	 * Presentation only — the parent (ChatPanel) owns the engine. Shows: the
	 * capability-probe recommendation with the detected signals ("Recommended for
	 * this device", always overridable); a picker listing each model's license
	 * and download size; an advanced custom-repo escape hatch; the active backend
	 * indicator; and download progress. Nothing downloads until the parent's
	 * onLoad fires from an explicit click here.
	 */
	import { MODELS, formatBytes, type ModelEntry } from '$lib/models/registry';
	import type { DeviceSignals, Recommendation } from '$lib/models/probe';
	import type { Backend } from '$lib/engine';
	import type { ModelSettings } from '$lib/models/settings';

	let {
		settings = $bindable(),
		signals,
		recommendation,
		status,
		progress,
		progressLabel = '',
		backend,
		loadedModelId,
		onLoad
	}: {
		settings: ModelSettings;
		signals: DeviceSignals | null;
		recommendation: Recommendation | null;
		status: 'idle' | 'loading' | 'ready' | 'error';
		progress: number;
		progressLabel?: string;
		backend: Backend | null;
		loadedModelId: string | null;
		onLoad: () => void;
	} = $props();

	const selected = $derived<ModelEntry | undefined>(MODELS.find((m) => m.id === settings.modelId));
	const isCustom = $derived(settings.modelId === 'custom');
	// The currently selected model differs from what's actually loaded → offer (re)load.
	const dirty = $derived(loadedModelId !== settings.modelId || status === 'idle' || status === 'error');
</script>

<div class="model-settings">
	{#if recommendation}
		<div class="reco" class:compat={recommendation.compatibilityMode}>
			<div class="reco-head">
				Recommended for this device: <strong>{recommendation.model.name}</strong>
				{#if recommendation.compatibilityMode}<span class="badge warn">compatibility mode</span>{/if}
			</div>
			<ul class="reasons">
				{#each recommendation.reasons as r}<li>{r}</li>{/each}
			</ul>
			{#if recommendation.downloadWarning}
				<p class="warn-line">
					⚠ This connection looks metered or slow — the download is {formatBytes(
						recommendation.model.approxBytes
					)}.
				</p>
			{/if}
		</div>
	{/if}

	<fieldset class="picker">
		<legend>Model</legend>
		{#each MODELS as m (m.id)}
			<label class="model-row" class:active={settings.modelId === m.id}>
				<input type="radio" name="model" value={m.id} bind:group={settings.modelId} />
				<span class="model-main">
					<span class="model-name">
						{m.name}
						{#if recommendation?.model.id === m.id}<span class="badge">recommended</span>{/if}
						{#if loadedModelId === m.id}<span class="badge ok">loaded</span>{/if}
					</span>
					<span class="model-meta">
						{m.params} · {formatBytes(m.approxBytes)} · {m.license} · {m.backend === 'webgpu'
							? 'WebGPU'
							: 'CPU/WASM'}
					</span>
					<span class="model-blurb">{m.blurb}</span>
				</span>
			</label>
		{/each}

		<label class="model-row" class:active={isCustom}>
			<input type="radio" name="model" value="custom" bind:group={settings.modelId} />
			<span class="model-main">
				<span class="model-name">Custom Hugging Face repo <span class="badge">advanced</span></span>
				<span class="model-blurb">
					Point at any ONNX model on the Hub — the model layer is itself remixable.
				</span>
			</span>
		</label>

		{#if isCustom}
			<div class="custom-fields">
				<input
					type="text"
					placeholder="onnx-community/Your-Model-ONNX"
					bind:value={settings.customRepo}
				/>
				<input type="text" placeholder="dtype (e.g. q4f16)" bind:value={settings.customDtype} />
				<p class="hint">
					Verify the license yourself — only permissively licensed weights fit this project's
					openness claim.
				</p>
			</div>
		{/if}
	</fieldset>

	<div class="controls">
		<label class="device-select">
			Backend:
			<select bind:value={settings.device}>
				<option value="auto">Auto (recommended)</option>
				<option value="webgpu">Force WebGPU</option>
				<option value="wasm">Force CPU/WASM</option>
			</select>
		</label>

		{#if backend}
			<span class="backend-indicator">
				Running on <strong>{backend === 'webgpu' ? 'WebGPU' : 'CPU/WASM'}</strong>
			</span>
		{/if}
	</div>

	{#if status === 'loading'}
		<div class="progress">
			<div class="bar"><div class="fill" style:width="{Math.round(progress * 100)}%"></div></div>
			<span class="progress-label">{progressLabel || `Downloading… ${Math.round(progress * 100)}%`}</span>
		</div>
	{:else}
		<button
			type="button"
			class="load-btn"
			disabled={(isCustom && !settings.customRepo) || (!dirty && status === 'ready')}
			onclick={onLoad}
		>
			{#if status === 'ready' && !dirty}
				Model ready
			{:else if selected}
				Download &amp; load {selected.name} ({formatBytes(selected.approxBytes)})
			{:else if isCustom}
				Download &amp; load custom model
			{:else}
				Load model
			{/if}
		</button>
		{#if status !== 'ready' || dirty}
			<p class="notice">
				Nothing downloads until you click. Weights are fetched once from Hugging Face's public CDN
				and cached in your browser — later visits work offline.
			</p>
		{/if}
	{/if}

	{#if signals}
		<details class="signals">
			<summary>Detected hardware signals</summary>
			<ul>
				<li>WebGPU adapter: {signals.webgpu ? 'yes' : 'no'}</li>
				{#if signals.maxBufferSize}<li>GPU maxBufferSize: {formatBytes(signals.maxBufferSize)}</li>{/if}
				{#if signals.deviceMemoryGiB}<li>Device memory: ~{signals.deviceMemoryGiB} GiB (browser-capped)</li>{/if}
				{#if signals.hardwareConcurrency}<li>CPU cores: {signals.hardwareConcurrency}</li>{/if}
				{#if signals.effectiveType}<li>Network: {signals.effectiveType}{signals.saveData ? ' (Data Saver on)' : ''}</li>{/if}
			</ul>
		</details>
	{/if}
</div>

<style>
	.model-settings {
		font-family: var(--font-ui);
		font-size: 0.9rem;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	.reco {
		background: var(--color-bg-raised);
		border: 1px solid var(--color-border);
		border-left: 3px solid var(--color-accent);
		border-radius: 0.3rem;
		padding: 0.7rem 0.9rem;
	}
	.reco.compat {
		border-left-color: #b8860b;
	}
	.reco-head {
		margin-bottom: 0.3rem;
	}
	.reasons {
		margin: 0.2rem 0 0;
		padding-left: 1.1rem;
		color: var(--color-text-muted);
		font-size: 0.82rem;
	}
	.warn-line {
		margin: 0.4rem 0 0;
		color: #b8860b;
		font-size: 0.82rem;
	}

	.badge {
		font-size: 0.68rem;
		background: var(--color-accent);
		color: var(--color-accent-contrast);
		border-radius: 0.6rem;
		padding: 0.05rem 0.45rem;
		margin-left: 0.3rem;
		vertical-align: middle;
	}
	.badge.ok {
		background: #2e7d32;
		color: #fff;
	}
	.badge.warn {
		background: #b8860b;
		color: #fff;
	}

	.picker {
		border: 1px solid var(--color-border);
		border-radius: 0.4rem;
		padding: 0.6rem 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.picker legend {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		padding: 0 0.3rem;
	}

	.model-row {
		display: flex;
		gap: 0.6rem;
		padding: 0.5rem;
		border-radius: 0.3rem;
		cursor: pointer;
		align-items: flex-start;
	}
	.model-row:hover {
		background: var(--color-bg);
	}
	.model-row.active {
		background: var(--color-bg);
		outline: 1px solid var(--color-border);
	}
	.model-main {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.model-name {
		font-weight: 600;
	}
	.model-meta {
		font-size: 0.78rem;
		color: var(--color-text-muted);
	}
	.model-blurb {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.custom-fields {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0 0.5rem 0.4rem;
	}
	.custom-fields input {
		font-family: var(--font-ui);
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 0.3rem;
		background: var(--color-bg);
		color: var(--color-text);
	}
	.hint {
		margin: 0;
		font-size: 0.76rem;
		color: var(--color-text-muted);
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.8rem;
	}
	.device-select select {
		font-family: var(--font-ui);
		margin-left: 0.3rem;
		padding: 0.25rem 0.4rem;
		border: 1px solid var(--color-border);
		border-radius: 0.3rem;
		background: var(--color-bg);
		color: var(--color-text);
	}
	.backend-indicator {
		font-size: 0.82rem;
		color: var(--color-text-muted);
	}

	.load-btn {
		background: var(--color-accent);
		color: var(--color-accent-contrast);
		border: none;
		border-radius: 0.3rem;
		padding: 0.6rem 1rem;
		cursor: pointer;
		font-size: 0.9rem;
	}
	.load-btn:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.notice {
		margin: 0;
		font-size: 0.78rem;
		color: var(--color-text-muted);
	}

	.progress {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.bar {
		height: 0.5rem;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.3rem;
		overflow: hidden;
	}
	.fill {
		height: 100%;
		background: var(--color-accent);
		transition: width 0.2s ease;
	}
	.progress-label {
		font-size: 0.78rem;
		color: var(--color-text-muted);
	}

	.signals {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}
	.signals summary {
		cursor: pointer;
	}
	.signals ul {
		margin: 0.3rem 0 0;
		padding-left: 1.1rem;
	}
</style>
