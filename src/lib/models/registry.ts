/**
 * Model registry (SPEC.md §5 "Models" + "Adaptive model selection").
 *
 * Three tiers of PERMISSIVELY-licensed instruct models, all available as ONNX
 * on the Hugging Face Hub and tagged for Transformers.js. Every entry's repo
 * id, license and ONNX weight variants were verified against huggingface.co at
 * build time (2026-07-08) — see the per-entry notes.
 *
 * The engine can load *any* ONNX repo from the Hub, so the "custom" escape
 * hatch (SPEC §5: "an advanced setting lets a user point at a different model")
 * lives in the settings UI, not here.
 */
import type { Backend } from '$lib/engine';

export type Tier = 'small' | 'default' | 'quality';

export interface ModelEntry {
	/** Stable key for persistence. */
	id: string;
	/** Human label for the picker. */
	name: string;
	tier: Tier;
	/** Hugging Face repo id passed to the engine. */
	repo: string;
	/** ONNX weight variant to request. */
	dtype: string;
	/** Approx download size of the chosen variant, bytes (for the pre-download notice). */
	approxBytes: number;
	/** SPDX-ish license string (permissive only). */
	license: string;
	/** Backend this tier is intended for. WASM-friendly tiers also run on WebGPU. */
	backend: Backend;
	/** Approx parameter count, for display. */
	params: string;
	/** One-line rationale shown in the picker. */
	blurb: string;
}

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

/**
 * Verified 2026-07-08 via WebFetch of the repos' `/tree/main/onnx` listings and
 * the base models' license fields on huggingface.co. All three are Apache-2.0
 * and carry the `transformers.js` library tag.
 */
export const MODELS: ModelEntry[] = [
	{
		id: 'qwen2.5-0.5b',
		name: 'Qwen2.5 0.5B Instruct',
		tier: 'small',
		repo: 'onnx-community/Qwen2.5-0.5B-Instruct',
		dtype: 'q4',
		approxBytes: Math.round(786 * MB), // model_q4.onnx = 786 MB
		license: 'Apache-2.0',
		backend: 'wasm',
		params: '0.5B',
		blurb: 'Runs on CPU/WASM everywhere — compatibility mode. Smallest download, simplest answers.'
	},
	{
		id: 'qwen3-1.7b',
		name: 'Qwen3 1.7B',
		tier: 'default',
		repo: 'onnx-community/Qwen3-1.7B-ONNX',
		dtype: 'q4f16',
		approxBytes: Math.round(1.43 * GB), // model_q4f16.onnx = 1.43 GB
		license: 'Apache-2.0',
		backend: 'webgpu',
		params: '1.7B',
		blurb: 'The recommended default when WebGPU is available — a good speed/quality balance.'
	},
	{
		id: 'qwen3-4b',
		name: 'Qwen3 4B',
		tier: 'quality',
		repo: 'onnx-community/Qwen3-4B-ONNX',
		dtype: 'q4f16',
		approxBytes: Math.round(2.84 * GB), // model_q4f16.onnx (+data shards) = ~2.84 GB
		license: 'Apache-2.0',
		backend: 'webgpu',
		params: '4B',
		blurb: 'Best answer quality — needs a capable GPU and the largest download.'
	}
];

export function getModel(id: string): ModelEntry | undefined {
	return MODELS.find((m) => m.id === id);
}

export function modelsForTier(tier: Tier): ModelEntry[] {
	return MODELS.filter((m) => m.tier === tier);
}

/** Human-readable size, e.g. "1.4 GB". */
export function formatBytes(bytes: number): string {
	if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
	if (bytes >= MB) return `${Math.round(bytes / MB)} MB`;
	return `${Math.round(bytes / 1024)} KB`;
}
