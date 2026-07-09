import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

/** Kit's `paths.base` type is `'' | \`/${string}\`` — narrow `BASE_PATH` (a plain env-var string)
 * into that shape, failing loudly on a malformed value (e.g. a trailing slash, or a value missing
 * its leading slash) rather than silently building a subtly-broken subpath deploy. */
function resolveBase(): '' | `/${string}` {
	const raw = process.env.BASE_PATH;
	if (!raw) return '';
	if (!raw.startsWith('/') || raw.endsWith('/')) {
		throw new Error(`BASE_PATH must start with "/" and not end with "/" (got "${raw}")`);
	}
	return raw as `/${string}`;
}

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// GitHub Pages project sites serve from a subpath (https://<user>.github.io/<repo>/), not
			// the domain root — every root-absolute internal reference (nav links, citations, book/media
			// fetches, the service worker, the manifest) must be prefixed with this at runtime via
			// `$app/paths`'s `base`. Unset (or empty) in dev/local builds, so `npm run dev`/plain
			// `npm run build` are byte-for-byte unchanged; the deploy workflow sets
			// `BASE_PATH=/<repo-name>` before building (see .github/workflows/deploy.yml).
			paths: { base: resolveBase() },

			// Static adapter: the whole app builds to a fully static site (GitHub Pages,
			// a thumb drive, any static host — see SPEC.md §2 "zero backend").
			adapter: adapter({
				pages: 'build',
				assets: 'build',
				fallback: undefined,
				precompress: false,
				strict: true
			}),

			// SPEC.md §8: "Missing media ⇒ figures show alt text ... chat is unaffected."
			// The reference book ships without its (gitignored) media, so figure <img>
			// links 404 at prerender time. Degrade those to alt text instead of failing
			// the static build; every other broken link still hard-errors.
			prerender: {
				// `path` is base-prefixed when `BASE_PATH` is set (SvelteKit reports the actual resolved
				// pathname), so match with `includes` rather than `startsWith`.
				handleHttpError: ({ path, referrer, message }) => {
					if (path.includes('/books/') && path.includes('/media/')) return;
					throw new Error(`${message}${referrer ? ` (linked from ${referrer})` : ''}`);
				}
			}
		})
	]
});
