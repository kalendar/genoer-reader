<script lang="ts">
	/**
	 * DEV-ONLY engine test harness — drives the inference engine directly with
	 * synthetic prompts of controlled size, bypassing retrieval/chat entirely.
	 * Used to isolate generation-crash variables (prompt size, sampling,
	 * dtype/backend) that the real chat UI can't hold constant. Not linked from
	 * any nav; harmless in production builds but intended for debugging.
	 */
	import type { Engine, ChatMessage } from '$lib/engine';

	let repo = $state('onnx-community/Qwen3-0.6B-ONNX');
	let dtype = $state('q4');
	let device = $state<'auto' | 'webgpu' | 'wasm'>('auto');
	let promptTokens = $state(50);
	let maxNewTokens = $state(32);
	let sample = $state(false);
	let log = $state('');
	let engine: Engine | null = null;
	let backend = $state('');
	let busy = $state(false);

	function out(line: string) {
		log += line + '\n';
	}

	async function load() {
		busy = true;
		try {
			if (!engine) {
				const { createEngine } = await import('$lib/engine');
				engine = createEngine();
			}
			out(`loading ${repo} dtype=${dtype} device=${device}…`);
			const t0 = performance.now();
			const res = await engine.loadModel(repo, { dtype, device, availableDtypes: ['q4', 'q4f16'] }, (p) => {
				if (p.overall !== undefined && p.overall < 1) log = log.replace(/loading[^\n]*$/, `loading… ${Math.round((p.overall ?? 0) * 100)}%`);
			});
			backend = res.backend;
			out(`READY backend=${res.backend} in ${Math.round(performance.now() - t0)}ms`);
		} catch (e) {
			out(`LOAD FAILED: ${e instanceof Error ? e.message : e}`);
		} finally {
			busy = false;
		}
	}

	async function gen() {
		if (!engine) {
			out('load a model first');
			return;
		}
		busy = true;
		const filler = 'The quick brown fox jumps over the lazy dog. '.repeat(Math.max(1, Math.round(promptTokens / 10)));
		const messages: ChatMessage[] = [
			{ role: 'system', content: 'You are a helpful assistant.' },
			{ role: 'user', content: filler + '\nReply with exactly one word.' }
		];
		out(`--- gen: ~${promptTokens} filler tokens, sample=${sample}, max_new=${maxNewTokens}`);
		const t0 = performance.now();
		try {
			const stream = engine.chat(messages, {
				maxNewTokens,
				temperature: sample ? 0.7 : 0
			});
			let text = '';
			let first = 0;
			for await (const chunk of stream) {
				if (!first) first = performance.now() - t0;
				text += chunk;
			}
			const u = await stream.usage.catch(() => null);
			out(`OK first-token=${Math.round(first)}ms total=${Math.round(performance.now() - t0)}ms prompt=${u?.promptTokens} completion=${u?.completionTokens} → "${text.trim().slice(0, 80)}"`);
		} catch (e) {
			out(`GEN FAILED after ${Math.round(performance.now() - t0)}ms: ${e instanceof Error ? e.message : e}`);
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>engine test</title></svelte:head>

<main style="font-family: monospace; padding: 1rem; max-width: 60rem; margin: 0 auto;">
	<h1>engine test harness</h1>
	<div style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center;">
		<input bind:value={repo} size="40" placeholder="repo" />
		<input bind:value={dtype} size="6" placeholder="dtype" />
		<select bind:value={device}>
			<option value="auto">auto</option>
			<option value="webgpu">webgpu</option>
			<option value="wasm">wasm</option>
		</select>
		<button onclick={load} disabled={busy}>Load</button>
		<span>{backend}</span>
	</div>
	<div style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; margin-top: 0.5rem;">
		<label>prompt tokens <input type="number" bind:value={promptTokens} style="width: 6rem" /></label>
		<label>max new <input type="number" bind:value={maxNewTokens} style="width: 5rem" /></label>
		<label><input type="checkbox" bind:checked={sample} /> sample (top_p)</label>
		<button onclick={gen} disabled={busy}>Generate</button>
	</div>
	<pre style="white-space: pre-wrap; background: #f4f1ea; padding: 0.8rem; margin-top: 1rem; min-height: 20rem;">{log}</pre>
</main>
