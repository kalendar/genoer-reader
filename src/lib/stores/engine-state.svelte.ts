/**
 * Shared, module-level engine state.
 *
 * Fixes a defect where `ChatPanel` and `PracticePanel` each held their own
 * `engine`/`status`/`backend`/`loadedModelId`/`progress`/`fallbackNotice`
 * component state (M4 duplicated M3's pattern). Consequence: any navigation
 * away and back — or an HMR reload — reset the panel to "download the
 * model", even though the multi-GB model was already loaded in the worker
 * and cached; and two panels could each spin up their own engine/worker
 * (double the model in memory), with neither ever disposing it.
 *
 * This module is the single source of truth: ONE `Engine` instance, created
 * lazily on the first explicit "load" click (SPEC §5: "nothing downloads
 * without a click"), reused by every consumer. Switching models replaces the
 * pipeline inside the existing worker rather than spinning up a second one.
 *
 * Svelte 5 runes at module scope (a `.svelte.ts` file) are the idiomatic way
 * to share fine-grained reactive state across components without prop
 * drilling — see `$lib/stores/highlights.ts` for the equivalent rationale
 * expressed with classic `svelte/store` writables, from before this codebase
 * leaned on runes everywhere. A plain singleton class works well here because
 * consumers need two-way binding into `ModelSettingsPanel` (`bind:settings`)
 * as well as imperative actions (`loadModel`), which runes support directly
 * as object/class field mutation — no store `set`/`update` ceremony needed.
 */
import type { Engine, Backend } from '$lib/engine';
import { recommendForDevice, type DeviceSignals, type Recommendation } from '$lib/models/probe';
import { loadSettings, saveSettings, resolveModel, type ModelSettings } from '$lib/models/settings';
import { requestPersistentStorage } from '$lib/utils/storage';

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error';

// The engine/worker handle is an imperative resource, not reactive UI state —
// deliberately kept outside the reactive class so it's never a render dependency.
let engine: Engine | null = null;
let probeStarted = false;

function engineErrorMessage(e: unknown): string {
	const msg = e instanceof Error ? e.message : String(e);
	return `Could not initialise the on-device model: ${msg}. The rest of the app still works — this is the only feature that needs the model.`;
}

class EngineState {
	status = $state<EngineStatus>('idle');
	progress = $state(0);
	progressLabel = $state('');
	backend = $state<Backend | null>(null);
	loadedModelId = $state<string | null>(null);
	engineError = $state<string | null>(null);
	fallbackNotice = $state<string | null>(null);
	/** Measured throughput of the most recently completed generation, across
	 * every consumer — surfaced in the chat page's compact "ready" bar. */
	lastTokensPerSecond = $state<number | null>(null);

	settings = $state<ModelSettings>({ modelId: 'qwen3-1.7b', contextLength: 8192, device: 'auto' });
	signals = $state<DeviceSignals | null>(null);
	recommendation = $state<Recommendation | null>(null);

	/**
	 * Probe device capability once for the whole app session and apply
	 * persisted/recommended settings. Safe to call from every consumer's
	 * `onMount` — later calls after the first are no-ops.
	 */
	async ensureProbed(): Promise<void> {
		if (probeStarted) return;
		probeStarted = true;
		const persisted = loadSettings();
		const { signals, recommendation } = await recommendForDevice();
		this.signals = signals;
		this.recommendation = recommendation;
		// Only apply a default/persisted choice if nothing has already started
		// loading (e.g. a race between two panels mounting before this resolves,
		// or the user already picked something in this session).
		if (this.status === 'idle') {
			this.settings = persisted ?? {
				modelId: recommendation.model.id,
				contextLength: recommendation.contextLength,
				device: 'auto'
			};
		}
	}

	/**
	 * Download (if needed) and initialise the shared engine with the current
	 * `settings`. Reuses the singleton engine/worker if one already exists —
	 * switching models replaces the pipeline in-place rather than creating a
	 * second worker (and a second copy of the model in memory).
	 */
	async loadModel(): Promise<void> {
		if (this.status === 'loading') return;
		this.status = 'loading';
		this.engineError = null;
		this.progress = 0;
		this.progressLabel = 'Preparing…';
		try {
			if (!engine) {
				const { createEngine } = await import('$lib/engine');
				engine = createEngine();
				engine.onFallback = (f) => {
					this.backend = f.to.backend;
					this.fallbackNotice =
						f.to.backend === 'wasm'
							? 'Your GPU had trouble running this model, so it switched to CPU compatibility mode — slower, but working.'
							: 'This model hit a GPU precision issue, so it reloaded with safer settings. Answers may be slightly slower.';
				};
			}
			const resolved = resolveModel(this.settings);
			const res = await engine.loadModel(
				resolved.repo,
				{
					dtype: resolved.dtype,
					device: this.settings.device,
					maxContext: this.settings.contextLength,
					availableDtypes: resolved.entry?.availableDtypes
				},
				(p) => {
					if (typeof p.overall === 'number') this.progress = p.overall;
					this.progressLabel = p.file
						? `Downloading ${p.file}… ${Math.round(this.progress * 100)}%`
						: '';
				}
			);
			this.backend = res.backend;
			this.loadedModelId = this.settings.modelId;
			this.status = 'ready';
			saveSettings(this.settings);
			// SPEC.md §10: ask the browser not to evict this (now multi-GB) origin under storage
			// pressure. Best-effort, fire-and-forget — see $lib/utils/storage for why this lives
			// outside the engine.
			void requestPersistentStorage();
		} catch (e) {
			this.status = 'error';
			this.engineError = engineErrorMessage(e);
		}
	}

	/**
	 * The live engine handle — null until `loadModel()` has resolved at least
	 * once this session. Consumers should only call `.chat()` on it when
	 * `status === 'ready'`.
	 */
	getEngine(): Engine | null {
		return engine;
	}

	recordTokensPerSecond(tps: number): void {
		this.lastTokensPerSecond = tps;
	}
}

/** The single shared instance — import this, never construct `EngineState` yourself. */
export const engineState = new EngineState();
