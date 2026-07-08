<script lang="ts">
	/**
	 * Per-section practice questions (SPEC.md §7 "Practice questions"): the
	 * on-device model generates multiple-choice and short-answer self-check
	 * questions grounded ONLY on the current section's blocks. Multiple-choice
	 * is graded locally (no round-trip needed); short answers are graded by
	 * asking the model to judge the response against the exact source block,
	 * with feedback that cites it.
	 *
	 * Reuses the same engine + capability-probe + model-settings machinery as
	 * `ChatPanel` (SPEC §5), including its honest WebGPU→WASM degradation
	 * messaging — this is a second, independent consumer of the same swappable
	 * engine interface, not a special case.
	 */
	import { onMount } from 'svelte';
	import type { ChatMessage } from '$lib/engine';
	import { buildPracticePrompt, buildEvaluationPrompt } from '$lib/practice/prompt';
	import { parseGeneratedQuestions, parseEvaluation } from '$lib/practice/parse';
	import type { GeneratedQuestion, PracticeAttempt, PracticeSession, PracticeBlock } from '$lib/practice/types';
	import { addSession, recordAttempt, sectionSessions, clearPracticeHistory } from '$lib/stores/practice';
	import { engineState } from '$lib/stores/engine-state.svelte';
	import ModelSettingsPanel from './ModelSettings.svelte';

	let {
		slug,
		sectionId,
		sectionTitle,
		sectionNumber,
		blocks
	}: {
		slug: string;
		sectionId: string;
		sectionTitle: string;
		sectionNumber: string | null;
		blocks: PracticeBlock[];
	} = $props();

	// ---- engine + model settings ----------------------------------------------
	// Shared with ChatPanel via `$lib/stores/engine-state.svelte` — this panel is
	// a second, independent consumer of the same singleton engine/worker (SPEC
	// §5), not a special case, and it must never re-prompt for a model that's
	// already loaded from the chat pane (or vice versa).
	let showSettings = $state(engineState.status !== 'ready');

	// ---- practice state ---------------------------------------------------
	let generating = $state(false);
	let genError = $state<string | null>(null);
	let session = $state<PracticeSession | null>(null);
	let history = $state<PracticeSession[]>([]);

	let mcSelections = $state<Record<string, number>>({});
	let shortDrafts = $state<Record<string, string>>({});
	let grading = $state<Record<string, boolean>>({});

	let blockByAnchor = $derived(new Map(blocks.map((b) => [b.anchor, b])));

	onMount(() => {
		history = sectionSessions(slug, sectionId);
		void engineState.ensureProbed();
	});

	// See ChatPanel.svelte for why this only fires on the idle/loading/error → ready
	// transition rather than on every read of `status` while ready.
	let prevEngineStatus = engineState.status;
	$effect(() => {
		const s = engineState.status;
		if (prevEngineStatus !== 'ready' && s === 'ready') {
			showSettings = false;
		}
		prevEngineStatus = s;
	});

	async function generateFullText(messages: ChatMessage[]): Promise<string> {
		const engine = engineState.getEngine();
		if (!engine) throw new Error('Model not loaded');
		const stream = engine.chat(messages, { maxNewTokens: 1400, temperature: 0.6 });
		let text = '';
		for await (const chunk of stream) text += chunk;
		return text;
	}

	async function generateQuestions() {
		if (engineState.status !== 'ready' || !engineState.getEngine() || generating) return;
		generating = true;
		genError = null;
		mcSelections = {};
		shortDrafts = {};
		try {
			const { system, user } = buildPracticePrompt(sectionTitle, blocks, 5);
			const raw = await generateFullText([
				{ role: 'system', content: system },
				{ role: 'user', content: user }
			]);
			const validAnchors = new Set(blocks.map((b) => b.anchor));
			const { questions, error } = parseGeneratedQuestions(raw, validAnchors);
			if (error) {
				genError = error;
				return;
			}
			const newSession: PracticeSession = {
				id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
				sectionId,
				sectionTitle,
				sectionNumber,
				createdAt: Date.now(),
				questions,
				attempts: {}
			};
			session = newSession;
			history = addSession(slug, newSession);
		} catch (e) {
			genError = e instanceof Error ? e.message : String(e);
		} finally {
			generating = false;
		}
	}

	function submitMc(q: GeneratedQuestion) {
		if (!session || q.choices == null || q.correctIndex == null) return;
		const selected = mcSelections[q.id];
		if (selected == null) return;
		const correct = selected === q.correctIndex;
		const attempt: PracticeAttempt = {
			questionId: q.id,
			userAnswer: q.choices[selected],
			selectedIndex: selected,
			correct,
			feedback: correct
				? 'Correct.'
				: `Not quite — the correct answer is "${q.choices[q.correctIndex]}".`,
			gradedAt: Date.now()
		};
		session = { ...session, attempts: { ...session.attempts, [q.id]: attempt } };
		history = recordAttempt(slug, session.id, q.id, attempt);
	}

	async function submitShort(q: GeneratedQuestion) {
		if (!session || engineState.status !== 'ready' || !engineState.getEngine()) return;
		const answer = (shortDrafts[q.id] ?? '').trim();
		if (!answer) return;
		const sourceBlock = blockByAnchor.get(q.anchor);
		const sourceText = sourceBlock?.text ?? '';
		grading = { ...grading, [q.id]: true };
		try {
			const { system, user } = buildEvaluationPrompt(q, sourceText, answer);
			const raw = await generateFullText([
				{ role: 'system', content: system },
				{ role: 'user', content: user }
			]);
			const parsed = parseEvaluation(raw);
			const attempt: PracticeAttempt = {
				questionId: q.id,
				userAnswer: answer,
				correct: parsed?.correct ?? false,
				feedback:
					parsed?.feedback ??
					'Could not parse the model\'s grading — here is the source passage to check your answer against yourself: "' +
						sourceText +
						'"',
				gradedAt: Date.now()
			};
			session = { ...session, attempts: { ...session.attempts, [q.id]: attempt } };
			history = recordAttempt(slug, session.id, q.id, attempt);
		} catch (e) {
			genError = e instanceof Error ? e.message : String(e);
		} finally {
			grading = { ...grading, [q.id]: false };
		}
	}

	function clearHistory() {
		clearPracticeHistory(slug);
		history = [];
		session = null;
	}
</script>

<section class="practice">
	<header class="practice-header">
		<div>
			<h1 class="practice-title">
				Practice — {sectionNumber ? `§${sectionNumber} ` : ''}{sectionTitle}
			</h1>
			<p class="machine-notice">
				Questions and feedback below are machine-generated by an on-device model, grounded only
				on this section's text. Nothing you type leaves your browser.
			</p>
		</div>
		<button type="button" class="settings-toggle" onclick={() => (showSettings = !showSettings)}>
			{showSettings ? 'Hide' : 'Model'} settings
		</button>
	</header>

	{#if showSettings || engineState.status !== 'ready'}
		<div class="settings-wrap">
			<ModelSettingsPanel
				bind:settings={engineState.settings}
				signals={engineState.signals}
				recommendation={engineState.recommendation}
				status={engineState.status}
				progress={engineState.progress}
				progressLabel={engineState.progressLabel}
				backend={engineState.backend}
				loadedModelId={engineState.loadedModelId}
				onLoad={() => engineState.loadModel()}
			/>
		</div>
	{/if}

	{#if engineState.status !== 'ready'}
		<p class="degrade-note">
			Load a model above to generate practice questions. Everything else in the reader works
			without it — this feature just can't run yet.
		</p>
	{/if}

	{#if engineState.engineError}<p class="error-note">{engineState.engineError}</p>{/if}
	{#if genError}<p class="error-note">{genError}</p>{/if}

	<div class="practice-actions">
		<button
			type="button"
			class="generate-btn"
			disabled={engineState.status !== 'ready' || generating}
			onclick={generateQuestions}
		>
			{generating ? 'Generating…' : 'Generate practice questions'}
		</button>
		{#if history.length > 0}
			<button type="button" class="clear-btn" onclick={clearHistory}>Clear practice history</button>
		{/if}
	</div>

	{#if session}
		<ol class="question-list">
			{#each session.questions as q, i (q.id)}
				{@const attempt = session.attempts[q.id]}
				<li class="question">
					<div class="question-head">
						<span class="question-index">Q{i + 1}</span>
						<span class="question-type">{q.type === 'mc' ? 'Multiple choice' : 'Short answer'}</span>
						<a class="question-source" href="/read/{sectionId}#{q.anchor}">Show me where this is covered</a>
					</div>
					<p class="question-prompt">{q.prompt}</p>

					{#if q.type === 'mc' && q.choices}
						<div class="mc-choices" role="radiogroup" aria-label="Answer choices">
							{#each q.choices as choice, ci (ci)}
								<label class="mc-choice" class:disabled={!!attempt}>
									<input
										type="radio"
										name="mc-{q.id}"
										checked={mcSelections[q.id] === ci}
										disabled={!!attempt}
										onchange={() => (mcSelections = { ...mcSelections, [q.id]: ci })}
									/>
									{choice}
								</label>
							{/each}
						</div>
						{#if !attempt}
							<button
								type="button"
								class="submit-btn"
								disabled={mcSelections[q.id] == null}
								onclick={() => submitMc(q)}
							>
								Submit answer
							</button>
						{/if}
					{:else}
						<textarea
							class="short-answer-input"
							rows="3"
							placeholder="Your answer…"
							disabled={!!attempt}
							value={attempt ? attempt.userAnswer : (shortDrafts[q.id] ?? '')}
							oninput={(e) => (shortDrafts = { ...shortDrafts, [q.id]: (e.currentTarget as HTMLTextAreaElement).value })}
						></textarea>
						{#if !attempt}
							<button
								type="button"
								class="submit-btn"
								disabled={!(shortDrafts[q.id] ?? '').trim() || grading[q.id] || engineState.status !== 'ready'}
								onclick={() => submitShort(q)}
							>
								{grading[q.id] ? 'Grading…' : 'Submit answer'}
							</button>
						{/if}
					{/if}

					{#if attempt}
						<p class="feedback" class:correct={attempt.correct} class:incorrect={!attempt.correct}>
							<strong>{attempt.correct ? 'Correct' : 'Not quite'}.</strong>
							{attempt.feedback}
							<span class="machine-tag">machine-generated</span>
						</p>
					{/if}
				</li>
			{/each}
		</ol>
	{/if}

	{#if history.length > 0}
		<details class="practice-history">
			<summary>Practice history for this section ({history.length} session{history.length === 1 ? '' : 's'})</summary>
			<ul>
				{#each history as s (s.id)}
					<li>
						{new Date(s.createdAt).toLocaleString()} — {s.questions.length} questions,
						{Object.values(s.attempts).filter((a) => a.correct).length} correct of {Object.keys(s.attempts).length} answered
					</li>
				{/each}
			</ul>
		</details>
	{/if}
</section>

<style>
	.practice {
		max-width: var(--measure);
		margin: 0 auto;
		padding: var(--space-2) var(--space-2) var(--space-4);
		font-family: var(--font-ui);
	}

	.practice-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--space-2);
	}

	.practice-title {
		font-family: var(--font-reading);
		font-size: 1.5rem;
		margin: 0 0 0.3rem;
	}

	.machine-notice {
		margin: 0;
		font-size: 0.82rem;
		color: var(--color-text-muted);
		max-width: 40rem;
	}

	.machine-tag {
		display: inline-block;
		margin-left: 0.4rem;
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
		border-radius: 0.2rem;
		padding: 0.02rem 0.3rem;
		vertical-align: middle;
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

	.practice-actions {
		display: flex;
		gap: 0.6rem;
		margin: var(--space-2) 0;
	}

	.generate-btn {
		background: var(--color-accent);
		color: var(--color-accent-contrast);
		border: none;
		border-radius: 0.4rem;
		padding: 0.6rem 1.1rem;
		cursor: pointer;
		font-size: 0.9rem;
	}
	.generate-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.clear-btn {
		background: none;
		border: 1px solid var(--color-border);
		border-radius: 0.4rem;
		padding: 0.6rem 1rem;
		cursor: pointer;
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}

	.question-list {
		list-style: none;
		margin: var(--space-3) 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.question {
		border: 1px solid var(--color-border);
		border-radius: 0.4rem;
		padding: var(--space-2);
		background: var(--color-bg-raised);
	}

	.question-head {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin-bottom: 0.4rem;
		font-size: 0.75rem;
	}

	.question-index {
		font-weight: 700;
		color: var(--color-accent);
	}

	.question-type {
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.question-source {
		margin-left: auto;
		font-size: 0.78rem;
	}

	.question-prompt {
		font-family: var(--font-reading);
		font-size: 1.05rem;
		margin: 0 0 var(--space-2);
	}

	.mc-choices {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		margin-bottom: var(--space-2);
	}

	.mc-choice {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 0.3rem;
		cursor: pointer;
		font-size: 0.9rem;
	}
	.mc-choice.disabled {
		cursor: default;
		opacity: 0.85;
	}

	.short-answer-input {
		width: 100%;
		font-family: var(--font-ui);
		font-size: 0.9rem;
		padding: 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 0.3rem;
		background: var(--color-bg);
		color: var(--color-text);
		resize: vertical;
		margin-bottom: 0.5rem;
	}
	.short-answer-input:disabled {
		opacity: 0.8;
	}

	.submit-btn {
		background: var(--color-accent);
		color: var(--color-accent-contrast);
		border: none;
		border-radius: 0.3rem;
		padding: 0.4rem 0.9rem;
		cursor: pointer;
		font-size: 0.85rem;
	}
	.submit-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.feedback {
		margin: var(--space-2) 0 0;
		padding: 0.6rem 0.7rem;
		border-radius: 0.3rem;
		font-size: 0.88rem;
		border-left: 3px solid var(--color-border);
	}
	.feedback.correct {
		border-left-color: #2e7d32;
		background: color-mix(in srgb, #2e7d32 8%, transparent);
	}
	.feedback.incorrect {
		border-left-color: #b8860b;
		background: color-mix(in srgb, #b8860b 8%, transparent);
	}

	.practice-history {
		margin-top: var(--space-3);
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}
	.practice-history summary {
		cursor: pointer;
	}
	.practice-history ul {
		margin: 0.4rem 0 0;
		padding-left: 1.2rem;
	}
</style>
