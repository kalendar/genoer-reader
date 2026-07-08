/**
 * Public surface of the engine layer (SPEC.md §5).
 *
 * Features import ONLY from here (or from `./types`). This is the boundary that
 * keeps `@huggingface/transformers` — imported solely by `worker.ts` — out of
 * the rest of the app, so the engine stays swappable.
 */
export { createEngine } from './transformers-engine';
export type {
	Engine,
	EngineConfig,
	ChatMessage,
	ChatRole,
	ChatStream,
	Backend,
	LoadOptions,
	LoadProgress,
	LoadResult,
	GenerateOptions,
	Usage
} from './types';
