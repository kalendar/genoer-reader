# GenOER Reader

A proof-of-concept "generative OER" web app — see [`SPEC.md`](./SPEC.md) for
the full design. Every layer is openly licensed and runs entirely in your
browser: an OpenStax textbook, a build-time-derived knowledge graph, and an
on-device LLM, with no backend, no accounts, and no cost. All five
milestones are built: the reader, the concept map, on-device chat, study
features (pathways/practice/highlights), and the loader/offline/5R layer
described below.

## Stack

SvelteKit (Svelte 5, TypeScript) with `@sveltejs/adapter-static` — the whole
app builds to a fully static site (no backend, deployable to GitHub Pages,
a bucket, or any static host — even a thumb drive). Cytoscape.js renders the
concept map; Transformers.js (ONNX Runtime Web) runs chat/practice-question
inference in a Web Worker, entirely client-side.

## Developing

```sh
npm install
npm run dev -- --open
```

This works immediately after a fresh `git clone` — the bundled book's
`book.json`/`graph.json` are committed to the repo (see "Book data" below);
only the (large, gitignored) `media/` folder is missing until you add it,
and the app degrades gracefully without it (figures show their alt text
instead of an image).

## Building & previewing

```sh
npm run build     # outputs the static site to ./build
npm run preview   # serve the built site locally (needed to exercise the
                   # service worker / offline behavior — see below; the dev
                   # server does not emit it)
```

`npm run build` succeeds on a fresh clone with no extra setup — verified by
cloning into a scratch directory and building with none of the gitignored
`media/` present. Prerendering degrades a missing figure image link to a
non-fatal warning (`vite.config.ts`'s `handleHttpError`) rather than failing
the build; the image `<img>` tag (with its already-baked-in `alt` text)
stays in the output, so the reader is fully usable — the picture just won't
load until real media is added.

## Testing & type-checking

```sh
npm run test    # node --test — unit tests for retrieval, practice parsing,
                 # highlight rendering, etc.
npm run check   # svelte-kit sync && svelte-check
```

Both are expected to be clean on `main`: 30/30 tests passing, 0
`svelte-check` errors. Three `state_referenced_locally` warnings in
`HighlightCard.svelte`/`BlockNoteCard.svelte` are intentional (documented
inline at each site — the components are deliberately remounted via
`{#key}` in their callers rather than reacting to a later prop change) and
are not bugs.

One pre-existing, unrelated `svelte-check` error in
`src/lib/retrieval/retrieval.test.ts` (an excess-property TypeScript check
on a test fixture) predates this milestone and does not affect `npm run
test`, which uses Node's native TypeScript support (type-stripping, not
type-checking) to run `.test.ts` files directly.

## Book data

The bundled reference book — OpenStax *Entrepreneurship* (CC BY-NC-SA 4.0)
— lives in `book-data/entrepreneurship/` (`book.json` and `graph.json` are
committed; `media/` is gitignored, ~150 MB) and is wired into the app via a
symlink at `static/books/entrepreneurship`. See `src/lib/data/book.ts` /
`src/lib/data/graph.ts` for the data-loading modules and schema types.

To get the media locally (for local development with working images), run
`npm run fetch-media` (`scripts/fetch-media.mjs` — plain Node, no deps; downloads
the ~217 referenced files from the upstream `osbooks-entrepreneurship` repo,
skipping any already present) or, if you're iterating on the source content
itself, run the [openstax-convert](https://github.com/kalendar/openstax-convert)
pipeline against the source OpenStax collection and copy its `media/`
output into `book-data/entrepreneurship/media/`. The app works correctly
without this step — see above.

### Loading a different book

Any book produced by `openstax-convert` (+ optionally
[openstax-graph](https://github.com/kalendar/openstax-graph)) works here,
unmodified — this is the whole point of the loader (SPEC.md §8):

- **From a URL:** open `/?book=<https URL of a directory containing
  book.json>` (the directory may also contain `graph.json` and `media/`),
  or use the "From a URL" tab of the loader on the landing page. The
  resolved book is registered in a small `localStorage` registry (slug →
  source URL) so it's remembered across visits.
- **From a local file:** the landing page's "From a file" tab accepts a
  dropped/picked `book.json` (and optionally `graph.json`), validated and
  parsed entirely in your browser (nothing is uploaded), then persisted to
  IndexedDB under a slug you choose — this is what lets the *same*
  `book.json` be loaded twice under different slugs with fully isolated
  annotations/history. Local loads don't include media (figures show alt
  text); use the URL loader for a book with working images.

Every route resolves "which book" from its own URL's `?book=` param (see
`src/lib/data/resolve-book.ts`); `src/lib/utils/book-link.ts` is what keeps
that param attached to every in-app link (nav, citations, deep links, ...)
as you navigate, rather than silently falling back to the bundled book the
moment you follow a link that doesn't know about it.

## PWA / offline

The app is installable and works offline after a first visit (SPEC.md
§10): a web manifest (`static/manifest.webmanifest`) plus a service worker
(`src/service-worker.ts`, SvelteKit's `$service-worker` module) precache
the app shell and the bundled book's `book.json`/`graph.json` — explicitly
**not** media, which is instead cached lazily, one file at a time, as it's
actually viewed. Only `npm run build && npm run preview` (or a real static
deploy) exercises this — `npm run dev` doesn't emit a service worker.

Once a chat/practice model finishes downloading, the app asks the browser
for persistent storage (`navigator.storage.persist()`, wired from
`$lib/stores/engine-state.svelte.ts`, outside the engine boundary) so a
multi-gigabyte cached model isn't evicted under storage pressure. Model
Settings shows live Cache Storage usage and a "Remove downloaded models"
button (`$lib/utils/storage.ts`).

**A note on iterating locally:** once a service worker has installed for
`localhost` (whatever port `vite preview` uses), it will keep serving that
cached build — including stale JS — until it's updated. If you rebuild and
the browser still shows old behavior, open devtools → Application →
Service Workers → Unregister (and clear the `genoer-shell-*` Cache Storage
entry), or just hard-reload twice. This is standard PWA update-lifecycle
behavior, not a bug.

## Deploying (GitHub Pages)

The repo ships with a GitHub Actions workflow
(`.github/workflows/deploy.yml`) that makes "fork it and Pages just works"
literally true — no forked-repo edits needed:

1. Fork the repo (see the footer's "Fork it on GitHub" link, `REPO_URL` in
   `src/lib/utils/repo.ts`).
2. Settings → Pages → Source: **GitHub Actions**.
3. Push to `main` (or run the workflow manually via Actions → "Deploy to
   GitHub Pages" → Run workflow). The workflow:
   - checks out the repo and installs dependencies (`npm ci`);
   - runs `node scripts/fetch-media.mjs`, which downloads the bundled
     reference book's ~217 media files straight from the upstream
     `osbooks-entrepreneurship` repo on GitHub (skipping any already
     present) — so a fresh fork gets working images without anyone
     hand-copying a `media/` folder;
   - builds with `BASE_PATH="/${{ github.event.repository.name }}"`, so
     the site's internal links/fetches are correctly prefixed for a
     **project** Pages site (`https://<user>.github.io/<repo>/`) —
     `${{ github.event.repository.name }}` (not a hardcoded
     `genoer-reader`) is what keeps this working under any fork name;
   - uploads `./build` as a Pages artifact and deploys it.

No server, no environment variables to set by hand, no secrets — the whole
deploy story really is "fork, flip one Settings toggle, push."

### Base path

GitHub Pages project sites serve from a subpath, not the domain root, so
every root-absolute internal reference (nav links, citations, `book.json`/
`graph.json`/media fetches, the service worker's precache list) is prefixed
via SvelteKit's `paths.base` (`vite.config.ts`, wired from the `BASE_PATH`
env var; see `$app/paths`'s `base` throughout `src/`). `BASE_PATH` is unset
in local dev and in a plain `npm run build`, so those remain byte-for-byte
unaffected — only the deploy workflow's build sets it. If you deploy
elsewhere at the domain root (a user/org Pages site, a bucket, a thumb
drive), just build with no `BASE_PATH` set.

### Media, manually

Prefer not to rely on the workflow's `fetch-media` step (e.g. building
locally for your own deploy)? Run `npm run fetch-media` yourself before
`npm run build`, or copy `media/` in directly per "Book data" above — the
app deploys and works fine without it either way (figures fall back to alt
text).

Because the whole app is prerendered per SPEC.md §2, every route ships as a
real static file — including a page per section of the bundled book,
generated at build time from its `book.json` (see
`src/routes/read/[sectionId]/+page.server.ts`'s `entries` export). A book
loaded at runtime via `?book=` obviously can't have build-time-generated
static pages of its own; navigating to one of its sections works via
client-side routing once the app shell has hydrated, the same way the rest
of the "load your own" flow does.

## Accessibility

WCAG 2.1 AA is the bar (SPEC.md §10). Notable points, should you extend the
app: every route has exactly one `<main>` landmark; reader/map popovers
close on Escape and return focus to whatever triggered them; user
highlights and glossary terms are both real Tab stops (`role="button"`,
keyboard-activatable); `prefers-reduced-motion` is respected (a global CSS
override, plus the concept map's Cytoscape layouts already run with
`animate: false` unconditionally); color contrast for warning text was
adjusted in `app.css` to clear 4.5:1 in both themes (see the
`--color-warn-text` comment there for the numbers).

## Privacy

No analytics, no telemetry, no cookies, no accounts. The only network calls
after the initial asset load are fetching whatever book you point the app
at and fetching model weights from Hugging Face's public CDN — both cached
locally afterward. See `/about` in the running app for the full story,
including the adversarial-verification numbers behind the concept graph and
a "make your own" walkthrough.

## Known limitations / left for a human

- **Icons** (`static/icons/*.png`, `static/icons/icon.svg`): functional
  placeholders generated for this milestone, not real brand assets — swap
  before a public deploy.
- **True offline (network-disconnected) testing** was verified indirectly
  — Cache Storage contents and the service worker's fetch-handler logic
  were inspected directly rather than tested with the network physically
  cut, since the tooling available during development didn't expose a
  clean way to do that without also tearing down the browser session.
