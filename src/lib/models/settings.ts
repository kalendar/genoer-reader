/**
 * Persisted model choice (SPEC.md §5: "The choice is remembered locally per
 * device"). localStorage only — no accounts, nothing leaves the browser (§2/§10).
 */
import type { ModelEntry } from './registry';
import { getModel } from './registry';

const KEY = 'genoer:model-settings';

export interface ModelSettings {
	/** Registry id, or a custom Hub repo id (advanced escape hatch, SPEC §5). */
	modelId: string;
	/** For custom repos: the ONNX dtype to request. */
	customRepo?: string;
	customDtype?: string;
	contextLength: number;
	/** 'auto' respects the probe; explicit values are user overrides. */
	device: 'auto' | 'webgpu' | 'wasm';
}

export function loadSettings(): ModelSettings | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as ModelSettings;
		// Migration: a persisted modelId that no longer exists in the registry
		// (e.g. the removed 1.7B tier) must not silently resolve as a raw repo —
		// discard it so the caller falls back to the current recommendation.
		if (parsed.modelId !== 'custom' && !getModel(parsed.modelId)) {
			localStorage.removeItem(KEY);
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

export function saveSettings(settings: ModelSettings): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(KEY, JSON.stringify(settings));
	} catch {
		/* private mode / quota — non-fatal, we just won't remember the choice */
	}
}

export function clearSettings(): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem(KEY);
	} catch {
		/* ignore */
	}
}

/**
 * Resolve settings to the concrete (repo, dtype) the engine needs. Handles both
 * registry entries and the custom-repo escape hatch.
 */
export function resolveModel(settings: ModelSettings): {
	repo: string;
	dtype?: string;
	entry?: ModelEntry;
} {
	if (settings.modelId === 'custom' && settings.customRepo) {
		return { repo: settings.customRepo, dtype: settings.customDtype };
	}
	const entry = getModel(settings.modelId);
	if (entry) return { repo: entry.repo, dtype: entry.dtype, entry };
	// Fall back to treating an unknown id as a raw repo.
	return { repo: settings.modelId, dtype: settings.customDtype };
}
