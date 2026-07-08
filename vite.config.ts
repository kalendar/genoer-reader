import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

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
				handleHttpError: ({ path, referrer, message }) => {
					if (path.startsWith('/books/') && path.includes('/media/')) return;
					throw new Error(`${message}${referrer ? ` (linked from ${referrer})` : ''}`);
				}
			}
		})
	]
});
