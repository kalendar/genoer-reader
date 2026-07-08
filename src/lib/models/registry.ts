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
	/**
	 * Every weight variant that actually exists in the repo (verified against
	 * the Hub's /tree/main/onnx listing). The engine's failure-fallback ladder
	 * only tries variants in this list — repos differ, and a blind reload of a
	 * nonexistent variant 404s.
	 */
	availableDtypes: string[];
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
		id: 'qwen3-0.6b-cpu',
		name: 'Qwen3 0.6B (CPU)',
		tier: 'small',
		repo: 'onnx-community/Qwen3-0.6B-ONNX',
		dtype: 'q4',
		availableDtypes: ['q4', 'q4f16', 'int8', 'quantized', 'bnb4', 'fp16'],
		approxBytes: Math.round(919 * MB), // model_q4.onnx = 919 MB
		license: 'Apache-2.0',
		backend: 'wasm',
		params: '0.6B',
		blurb: 'Runs on CPU/WASM everywhere — compatibility mode. Works without WebGPU.'
	},
	{
		id: 'qwen3-0.6b',
		name: 'Qwen3 0.6B',
		tier: 'default',
		repo: 'onnx-community/Qwen3-0.6B-ONNX',
		// q4f16 — the exact config of the official Transformers.js WebGPU demo.
		// Verified fast+stable on transformers.js 3.7.1 (pinned in package.json):
		// the 4.x line's rewritten WebGPU runtime crashed this dtype at inference
		// on Chrome/macOS (see /dev/engine-test harness findings, 2026-07-08).
		// Do not bump to transformers.js 4.x without re-running the harness ladder.
		dtype: 'q4f16',
		availableDtypes: ['q4', 'q4f16', 'int8', 'quantized', 'bnb4', 'fp16'],
		approxBytes: Math.round(570 * MB), // model_q4f16.onnx = 570 MB
		license: 'Apache-2.0',
		backend: 'webgpu',
		params: '0.6B',
		blurb: 'The recommended default — the exact model and settings of the official Transformers.js WebGPU demo, with q4 and CPU fallbacks if your GPU misbehaves.'
	},
	// NOTE: Qwen3-1.7B-ONNX was removed from the registry (2026-07-08): its only
	// quantized variants are MONOLITHIC files ≥ 1.4 GB, and onnxruntime-web
	// cannot create a session from them in Chrome (std::bad_alloc parsing the
	// protobuf in the 32-bit WASM heap — reproduced on two machines). Restore a
	// mid tier when a sharded-external-data 1.7B conversion exists.
	{
		id: 'qwen3-4b',
		name: 'Qwen3 4B',
		tier: 'quality',
		repo: 'onnx-community/Qwen3-4B-ONNX',
		dtype: 'q4f16',
		availableDtypes: ['q4f16', 'fp16'], // no q4 — verified 2026-07-08; ladder is GPU-or-nothing
		approxBytes: Math.round(2.84 * GB), // model_q4f16.onnx (+data shards) = ~2.84 GB
		license: 'Apache-2.0',
		backend: 'webgpu',
		params: '4B',
		blurb: 'Best answer quality — the largest download, needs GPU buffer limits above 4 GiB, and has no q4 fallback variant if fp16 compute misbehaves on your GPU.'
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
