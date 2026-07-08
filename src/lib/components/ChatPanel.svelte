<script lang="ts">
	/**
	 * Reusable on-device chat panel (SPEC.md §5).
	 *
	 * Ties together the swappable engine (`$lib/engine`), the capability probe +
	 * model registry (`$lib/models`), and graph-assisted retrieval
	 * (`$lib/retrieval`): streaming grounded answers, clickable citations, a
	 * transparency panel, a model picker, multi-turn history persisted per book
	 * slug, and honest degradation when WebGPU or the engine is unavailable.
	 *
	 * The engine (and thus `@huggingface/transformers`) is dynamically imported
	 * only when the user explicitly loads a model, keeping the initial bundle
	 * light and honoring "nothing downloads without a click".
	 */
	import { onMount } from 'svelte';
	import type { Engine, Backend, ChatStream } from '$lib/engine';
	import { buildGroundedPrompt, type Graph, type Passage, type RetrievalBook } from '$lib/retrieval';
	import { recommendForDevice, type DeviceSignals, type Recommendation } from '$lib/models/probe';
	import { loadSettings, saveSettings, resolveModel, type ModelSettings } from '$lib/models/settings';
	import {
		loadHistory,
		saveHistory,
		clearHistory,
		exportHistory,
		newId,
		type ChatTurn
	} from '$lib/stores/chat';
	import { getPosition } from '$lib/stores/reading-position';
	import { composeMessages } from '$lib/chat/messages';
	import { parseCitations } from '$lib/chat/citations';
	import ModelSettingsPanel from './ModelSettings.svelte';
	import GroundingPanel from './GroundingPanel.svelte';

	let {
		book,
		graph = null,
		slug
	}: { book: RetrievalBook; graph?: Graph | null; slug: string } = $props();

	// ---- reactive state -------------------------------------------------------
	let turns = $state<ChatTurn[]>([]);
	let question = $state('');
	let settings = $state<ModelSettings>({ modelId: 'qwen3-1.7b', contextLength: 8192, device: 'auto' });
	let signals = $state<DeviceSignals | null>(null);
	let recommendation = $state<Recommendation | null>(null);

	let status = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	let progress = $state(0);
	let progressLabel = $state('');
	let backend = $state<Backend | null>(null);
	let loadedModelId = $state<string | null>(null);
	let engineError = $state<string | null>(null);

	let generating = $state(false);
	let streaming = $state('');
	let streamingPassages = $state<Passage[]>([]);
	let speedWarning = $state(false);
	let showSettings = $state(true);

	// Engine + active stream are imperative handles, not reactive UI state.
	let engine: Engine | null = null;
	let activeStream: ChatStream | null = null;
	let scroller: HTMLDivElement | null = null;

	const GEN_HEADROOM = 512;
	const SYSTEM_RESERVE = 300;

	function approxTokens(text: string): number {
		return Math.ceil(text.length / 4);
	}

	const budgetTokens = $derived.by(() => {
		const historyTokens = turns.reduce((sum, t) => sum + approxTokens(t.content), 0);
		return Math.max(800, settings.contextLength - GEN_HEADROOM - SYSTEM_RESERVE - historyTokens);
	});

	onMount(() => {
		turns = loadHistory(slug);
		const persisted = loadSettings();
		(async () => {
			const { signals: sig, recommendation: reco } = await recommendForDevice();
			signals = sig;
			recommendation = reco;
			if (persisted) {
				settings = persisted;
			} else {
				settings = {
					modelId: reco.model.id,
					contextLength: reco.contextLength,
					device: 'auto'
				};
			}
		})();
	});

	$effect(() => {
		// Autoscroll on new content.
		void turns.length;
		void streaming;
		if (scroller) scroller.scrollTop = scroller.scrollHeight;
	});

	function engineErrorMessage(e: unknown): string {
		const msg = e instanceof Error ? e.message : String(e);
		return `Could not initialise the on-device model: ${msg}. The rest of the app still works — this is the only feature that needs the model.`;
	}

	async function loadModel() {
		status = 'loading';
		engineError = null;
		progress = 0;
		progressLabel = 'Preparing…';
		speedWarning = false;
		try {
			if (!engine) {
				const { createEngine } = await import('$lib/engine');
				engine = createEngine();
			}
			const resolved = resolveModel(settings);
			const res = await engine.loadModel(
				resolved.repo,
				{ dtype: resolved.dtype, device: settings.device, maxContext: settings.contextLength },
				(p) => {
					if (typeof p.overall === 'number') progress = p.overall;
					progressLabel = p.file ? `Downloading ${p.file}… ${Math.round(progress * 100)}%` : '';
				}
			);
			backend = res.backend;
			loadedModelId = settings.modelId;
			status = 'ready';
			showSettings = false;
			saveSettings(settings);
		} catch (e) {
			status = 'error';
			engineError = engineErrorMessage(e);
		}
	}

	async function send() {
		const q = question.trim();
		if (!q || generating || status !== 'ready' || !engine) return;
		question = '';
		engineError = null;

		const currentSectionId = getPosition(slug)?.sectionId ?? null;
		const gp = buildGroundedPrompt(q, book, graph, {
			currentSectionId,
			budgetTokens,
			bookTitle: book.title
		});

		const userTurn: ChatTurn = { id: newId(), role: 'user', content: q, createdAt: Date.now() };
		const priorHistory = turns; // context = everything before this question
		turns = [...turns, userTurn];

		const messages = composeMessages(gp.system, priorHistory, gp.user);

		generating = true;
		streaming = '';
		streamingPassages = gp.passages;

		try {
			const stream = engine.chat(messages, { maxNewTokens: GEN_HEADROOM, temperature: 0.7 });
			activeStream = stream;
			for await (const chunk of stream) {
				streaming += chunk;
			}
			const usage = await stream.usage.catch(() => null);
			const tps = usage?.tokensPerSecond ?? 0;
			const assistantTurn: ChatTurn = {
				id: newId(),
				role: 'assistant',
				content: streaming,
				passages: gp.passages,
				matchedTerms: gp.matchedConcepts.map((m) => m.concept.term),
				usedFallback: gp.usedFallback,
				backend: backend ?? undefined,
				tokensPerSecond: tps,
				createdAt: Date.now()
			};
			turns = [...turns, assistantTurn];
			saveHistory(slug, turns);
			// SPEC §5 verification: warn (not force) if throughput is below a usability floor.
			if (tps > 0 && tps < 3) speedWarning = true;
		} catch (e) {
			engineError = e instanceof Error ? e.message : String(e);
			// Keep any partial text as the assistant turn so the transcript stays coherent.
			if (streaming) {
				turns = [
					...turns,
					{
						id: newId(),
						role: 'assistant',
						content: streaming + '\n\n[generation interrupted]',
						passages: gp.passages,
						usedFallback: gp.usedFallback,
						createdAt: Date.now()
					}
				];
				saveHistory(slug, turns);
			}
		} finally {
			generating = false;
			streaming = '';
			streamingPassages = [];
			activeStream = null;
		}
	}

	function stop() {
		activeStream?.abort();
	}

	function clearAll() {
		clearHistory(slug);
		turns = [];
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send();
		}
	}

	function segmentsFor(content: string, passages: Passage[] | undefined) {
		return parseCitations(content, passages ?? []);
	}
</script>

<section class="chat">
	<header class="chat-header">
		<div>
			<h1 class="chat-title">Ask this book</h1>
			<p class="machine-notice">
				Answers are machine-generated by an on-device model. The cited passages are the
				authority — follow a citation to read the source. Nothing you type leaves your browser.
			</p>
		</div>
		<button
			type="button"
			class="settings-toggle"
			aria-expanded={showSettings}
			onclick={() => (showSettings = !showSettings)}
		>
			{showSettings ? 'Hide' : 'Model'} settings
		</button>
	</header>

	{#if showSettings || status !== 'ready'}
		<div class="settings-wrap">
			<ModelSettingsPanel
				bind:settings
				{signals}
				{recommendation}
				{status}
				{progress}
				{progressLabel}
				{backend}
				{loadedModelId}
				onLoad={loadModel}
			/>
		</div>
	{/if}

	{#if !graph}
		<p class="degrade-note">
			This book has no knowledge graph — answers are grounded on the section you're currently
			reading rather than graph-retrieved passages.
		</p>
	{/if}

	{#if engineError}
		<p class="error-note">{engineError}</p>
	{/if}
	{#if speedWarning}
		<p class="degrade-note">
			Generation is slow on this device. You can step down to a smaller model in settings for
			faster (if simpler) answers.
		</p>
	{/if}

	<div class="transcript" bind:this={scroller}>
		{#if turns.length === 0 && !generating}
			<div class="empty">
				<p>
					Ask a question about <strong>{book.title ?? 'this book'}</strong>. The answer is
					retrieved from the book's own passages
					{#if graph}via its knowledge graph{/if} and every claim links back to where it's
					covered.
				</p>
				{#if status !== 'ready'}
					<p class="empty-hint">Load a model above to begin.</p>
				{/if}
			</div>
		{/if}

		{#each turns as turn (turn.id)}
			{#if turn.role === 'user'}
				<div class="turn user"><div class="bubble">{turn.content}</div></div>
			{:else}
				<div class="turn assistant">
					<div class="bubble">
						{#each segmentsFor(turn.content, turn.passages) as seg}
							{#if seg.type === 'text'}{seg.text}{:else}<a
									class="citation"
									href={seg.href}
									title="Passage {seg.index} — open in reader">[{seg.index}]</a
								>{/if}
						{/each}
					</div>
					<GroundingPanel
						passages={turn.passages ?? []}
						matchedTerms={turn.matchedTerms ?? []}
						usedFallback={turn.usedFallback ?? false}
					/>
					{#if turn.tokensPerSecond}
						<div class="turn-meta">
							{turn.backend === 'webgpu' ? 'WebGPU' : 'CPU/WASM'} · {turn.tokensPerSecond.toFixed(1)}
							tok/s
						</div>
					{/if}
				</div>
			{/if}
		{/each}

		{#if generating}
			<div class="turn assistant">
				<div class="bubble">
					{#each segmentsFor(streaming, streamingPassages) as seg}
						{#if seg.type === 'text'}{seg.text}{:else}<a class="citation" href={seg.href}
								>[{seg.index}]</a
							>{/if}
					{/each}<span class="cursor">▍</span>
				</div>
			</div>
		{/if}
	</div>

	<div class="composer">
		<textarea
			bind:value={question}
			onkeydown={onKeydown}
			placeholder={status === 'ready'
				? 'Ask a question about this book…'
				: 'Load a model to start chatting…'}
			rows="2"
			disabled={status !== 'ready' || generating}
		></textarea>
		{#if generating}
			<button type="button" class="send stop" onclick={stop}>Stop</button>
		{:else}
			<button type="button" class="send" onclick={send} disabled={status !== 'ready' || !question.trim()}>
				Send
			</button>
		{/if}
	</div>

	{#if turns.length > 0}
		<div class="transcript-actions">
			<button type="button" onclick={() => exportHistory(slug, turns)}>Export transcript</button>
			<button type="button" onclick={clearAll}>Clear history</button>
		</div>
	{/if}
</section>

<style>
	.chat {
		max-width: 48rem;
		margin: 0 auto;
		padding: var(--space-2);
		font-family: var(--font-ui);
		display: flex;
		flex-direction: column;
		min-height: 100vh;
	}

	.chat-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--space-2);
	}
	.chat-title {
		font-family: var(--font-reading);
		font-size: 1.6rem;
		margin: 0 0 0.3rem;
	}
	.machine-notice {
		margin: 0;
		font-size: 0.82rem;
		color: var(--color-text-muted);
		max-width: 40rem;
	}
	.settings-toggle {
		flex: 0 0 auto;
		background: var(--color-bg-raised);
		border: 1px solid var(--color-border);
		border-radius: 0.3rem;
		padding: 0.4rem 0.8rem;
		cursor: pointer;
		color: var(--color-text);
		font-size: 0.85rem;
	}

	.settings-wrap {
		margin: var(--space-2) 0;
		padding: var(--space-2);
		background: var(--color-bg-raised);
		border: 1px solid var(--color-border);
		border-radius: 0.4rem;
	}

	.degrade-note,
	.error-note {
		font-size: 0.85rem;
		border-radius: 0.3rem;
		padding: 0.6rem 0.8rem;
		margin: 0.5rem 0;
	}
	.degrade-note {
		background: var(--color-bg-raised);
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
	}
	.error-note {
		background: #fdecea;
		border: 1px solid #f5c6cb;
		color: #a12a2a;
	}
	@media (prefers-color-scheme: dark) {
		.error-note {
			background: #3a1c1c;
			border-color: #5a2a2a;
			color: #f0b0b0;
		}
	}

	.transcript {
		flex: 1 1 auto;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-2) 0;
		min-height: 12rem;
	}

	.empty {
		color: var(--color-text-muted);
		font-size: 0.95rem;
		max-width: 34rem;
	}
	.empty-hint {
		font-style: italic;
	}

	.turn {
		display: flex;
		flex-direction: column;
	}
	.turn.user {
		align-items: flex-end;
	}
	.turn.assistant {
		align-items: flex-start;
	}
	.bubble {
		max-width: 90%;
		padding: 0.6rem 0.9rem;
		border-radius: 0.6rem;
		line-height: 1.55;
		white-space: pre-wrap;
		word-wrap: break-word;
	}
	.turn.user .bubble {
		background: var(--color-accent);
		color: var(--color-accent-contrast);
		border-bottom-right-radius: 0.2rem;
	}
	.turn.assistant .bubble {
		background: var(--color-bg-raised);
		border: 1px solid var(--color-border);
		border-bottom-left-radius: 0.2rem;
	}

	.citation {
		color: var(--color-accent);
		font-weight: 600;
		text-decoration: none;
		font-size: 0.85em;
		padding: 0 0.05em;
	}
	.citation:hover {
		text-decoration: underline;
	}

	.cursor {
		animation: blink 1s steps(1) infinite;
	}
	@keyframes blink {
		50% {
			opacity: 0;
		}
	}

	.turn-meta {
		font-size: 0.72rem;
		color: var(--color-text-muted);
		margin-top: 0.2rem;
	}

	.composer {
		display: flex;
		gap: 0.5rem;
		align-items: flex-end;
		border-top: 1px solid var(--color-border);
		padding-top: var(--space-2);
	}
	.composer textarea {
		flex: 1 1 auto;
		resize: vertical;
		font-family: var(--font-ui);
		font-size: 0.95rem;
		padding: 0.6rem 0.7rem;
		border: 1px solid var(--color-border);
		border-radius: 0.4rem;
		background: var(--color-bg-raised);
		color: var(--color-text);
	}
	.composer textarea:disabled {
		opacity: 0.6;
	}
	.send {
		flex: 0 0 auto;
		background: var(--color-accent);
		color: var(--color-accent-contrast);
		border: none;
		border-radius: 0.4rem;
		padding: 0.6rem 1.1rem;
		cursor: pointer;
		font-size: 0.9rem;
	}
	.send:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.send.stop {
		background: #a12a2a;
		color: #fff;
	}

	.transcript-actions {
		display: flex;
		gap: 0.5rem;
		margin-top: var(--space-1);
	}
	.transcript-actions button {
		background: none;
		border: 1px solid var(--color-border);
		border-radius: 0.3rem;
		padding: 0.35rem 0.7rem;
		cursor: pointer;
		color: var(--color-text-muted);
		font-size: 0.8rem;
	}
	.transcript-actions button:hover {
		border-color: var(--color-accent);
		color: var(--color-accent);
	}
</style>
