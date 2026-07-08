# GenOER Reader

A proof-of-concept "generative OER" web app — see [`SPEC.md`](./SPEC.md) for
the full design. Milestone 1 (this state of the repo) is the SvelteKit
scaffold and the Reader component: table of contents, section rendering,
prev/next navigation, deep links, reading-position persistence, and
attribution. Chat, the concept map, and study features land in later
milestones.

## Stack

SvelteKit (Svelte 5, TypeScript) with `@sveltejs/adapter-static` — the whole
app builds to a fully static site (no backend, deployable to GitHub Pages or
any static host).

## Developing

```sh
npm install
npm run dev -- --open
```

## Building

```sh
npm run build   # outputs to ./build
npm run preview # serve the built static site locally
```

## Book data

The reader loads `book.json` (+ `media/`) from `static/books/<slug>/`,
produced by the [openstax-convert](https://github.com/kalendar/openstax-convert)
pipeline. The bundled reference book (OpenStax *Entrepreneurship*) lives in
`book-data/entrepreneurship/` and is wired in via a symlink at
`static/books/entrepreneurship` — media is large, so it's linked, not copied.
See `src/lib/data/book.ts` for the data-loading module and schema types.
