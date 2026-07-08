/**
 * Capability probe (SPEC.md §5 "Adaptive model selection").
 *
 * Reads the (deliberately blurred) hardware signals browsers expose, then
 * *recommends* a model tier — never silently imposes it. The recommendation
 * and every signal that fed it are surfaced in the picker ("Recommended for
 * this device", with the detected signals shown) and are always overridable.
 *
 * Pure-ish: `probeDevice()` touches Web APIs; `recommend()` is a pure function
 * of a {@link DeviceSignals} object, so the decision logic is unit-testable.
 */
import { MODELS, type ModelEntry, type Tier } from './registry';

export interface DeviceSignals {
	/** navigator.gpu present AND an adapter resolved. */
	webgpu: boolean;
	/** Coarse GPU-memory proxy from adapter limits, bytes (undefined if no WebGPU). */
	maxBufferSize?: number;
	maxStorageBufferBindingSize?: number;
	/** navigator.deviceMemory (GiB, capped at 8 by the browser for privacy). */
	deviceMemoryGiB?: number;
	hardwareConcurrency?: number;
	/** Network Information API — used only to warn before a big download. */
	saveData?: boolean;
	effectiveType?: string;
}

export interface Recommendation {
	tier: Tier;
	model: ModelEntry;
	/** Suggested engine context window (tokens). */
	contextLength: number;
	/** Human-readable reasons, shown verbatim in the UI. */
	reasons: string[];
	/** True when the recommendation is CPU/WASM (compatibility mode). */
	compatibilityMode: boolean;
	/** True when a metered/slow/save-data connection was detected. */
	downloadWarning: boolean;
}

interface AdapterLike {
	limits?: {
		maxBufferSize?: number;
		maxStorageBufferBindingSize?: number;
	};
}

/** Gather signals from the current device. Safe to call anywhere (guards every API). */
export async function probeDevice(): Promise<DeviceSignals> {
	const nav = (typeof navigator !== 'undefined' ? navigator : {}) as Navigator & {
		gpu?: {
			requestAdapter(): Promise<AdapterLike | null>;
		};
		deviceMemory?: number;
		connection?: { saveData?: boolean; effectiveType?: string };
	};

	const signals: DeviceSignals = {
		webgpu: false,
		deviceMemoryGiB: nav.deviceMemory,
		hardwareConcurrency: nav.hardwareConcurrency,
		saveData: nav.connection?.saveData,
		effectiveType: nav.connection?.effectiveType
	};

	if (nav.gpu) {
		try {
			const adapter = await nav.gpu.requestAdapter();
			if (adapter) {
				signals.webgpu = true;
				signals.maxBufferSize = adapter.limits?.maxBufferSize;
				signals.maxStorageBufferBindingSize = adapter.limits?.maxStorageBufferBindingSize;
			}
		} catch {
			/* treat as no WebGPU */
		}
	}

	return signals;
}

const GiB = 1024 * 1024 * 1024;

function byId(id: string): ModelEntry {
	const m = MODELS.find((x) => x.id === id);
	if (!m) throw new Error(`registry missing model ${id}`);
	return m;
}

/**
 * Pure recommendation logic. Heuristic by design (SPEC §5 "browsers deliberately
 * blur hardware signals"): pick the largest tier whose weights-plus-KV estimate
 * plausibly fits the memory signals, then set a context window the grounding
 * pipeline can actually use.
 */
export function recommend(s: DeviceSignals): Recommendation {
	const reasons: string[] = [];
	const downloadWarning = Boolean(s.saveData) || s.effectiveType === '2g' || s.effectiveType === 'slow-2g';
	if (downloadWarning) {
		reasons.push(
			s.saveData
				? 'Data Saver is on — flagging the download size before you commit.'
				: `Connection looks slow (${s.effectiveType}) — the model download may take a while.`
		);
	}

	// No WebGPU → compatibility mode with the small WASM model.
	if (!s.webgpu) {
		reasons.push('No WebGPU adapter detected — using the CPU/WASM compatibility path.');
		if (s.hardwareConcurrency) {
			reasons.push(`${s.hardwareConcurrency} logical CPU cores available.`);
		}
		return {
			tier: 'small',
			model: byId('qwen3-0.6b-cpu'),
			contextLength: 4096,
			reasons,
			compatibilityMode: true,
			downloadWarning
		};
	}

	reasons.push('WebGPU adapter present — GPU-accelerated inference available.');

	// Coarse GPU-memory proxy. maxBufferSize is conservative but monotonic enough
	// to separate low-end (default tier) from high-end (quality tier) GPUs.
	const bufGiB = (s.maxBufferSize ?? 0) / GiB;
	const bindGiB = (s.maxStorageBufferBindingSize ?? 0) / GiB;
	const gpuProxyGiB = Math.max(bufGiB, bindGiB);
	if (s.maxBufferSize) {
		reasons.push(`GPU maxBufferSize ≈ ${bufGiB.toFixed(1)} GiB (coarse memory proxy).`);
	}
	const deviceMem = s.deviceMemoryGiB;
	if (deviceMem) {
		reasons.push(`Reported device memory ≈ ${deviceMem} GiB (browser-capped at 8).`);
	}

	// Quality tier (~4B q4f16 ≈ 2.8 GB weights + a growing KV cache): needs GPU
	// buffer limits comfortably ABOVE the common 4 GiB default. Observed in the
	// wild: on a 4 GiB-capped adapter the 4B tier works for a first short
	// question, then crashes with an onnxruntime SafeInt integer overflow once
	// history grows the KV allocation. So the bar is deliberately high.
	const bigGpu = gpuProxyGiB >= 5;
	const roomyMem = (deviceMem ?? 8) >= 8; // undefined → assume the 8-cap best case

	if (bigGpu && roomyMem) {
		reasons.push('GPU buffer limits exceed 5 GiB — sufficient headroom for the 4B quality tier.');
		return {
			tier: 'quality',
			model: byId('qwen3-4b'),
			contextLength: 4096,
			reasons,
			compatibilityMode: false,
			downloadWarning
		};
	}

	if (gpuProxyGiB > 0 && gpuProxyGiB < 5) {
		reasons.push(
			`The 4B tier needs GPU buffers beyond this adapter's ~${gpuProxyGiB.toFixed(1)} GiB ceiling once the attention cache grows — recommending the default tier, which also has the broadest fallback options.`
		);
	} else {
		reasons.push('Recommending the default tier — the safe WebGPU balance for this device.');
	}
	return {
		tier: 'default',
		model: byId('qwen3-0.6b'),
		contextLength: 4096,
		reasons,
		compatibilityMode: false,
		downloadWarning
	};
}

/** Convenience: probe + recommend in one call. */
export async function recommendForDevice(): Promise<{ signals: DeviceSignals; recommendation: Recommendation }> {
	const signals = await probeDevice();
	return { signals, recommendation: recommend(signals) };
}
