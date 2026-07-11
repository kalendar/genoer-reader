# GenOER Reader — Design Specification

**Status:** Draft v0.3 (2026-07-08) · proof of concept

## 1. Purpose

A proof-of-concept demonstrating what AI-powered open educational resources
("generative OER") might look like. The tool combines an openly licensed
textbook, a build-time-derived knowledge graph, and an in-browser LLM into a
single web application in which **every layer — content, code, data, and model
weights — is openly licensed**, so end users can exercise the 5Rs (Retain,
Revise, Remix, Reuse, Redistribute) over the whole artifact, not just the text.

The PoC must be **completely free to use, forever**. This is a hard constraint,
not an aspiration, and it drives the architecture: no backend, no API keys, no
accounts, no metered services anywhere in the runtime path.

## 2. Design principles

1. **Zero backend.** The entire application is a static site. Anything that
   can be hosted on GitHub Pages (or any static host, or a thumb drive) forever
   at zero marginal cost.
2. **Build-time intelligence, runtime traversal.** Expensive, hallucination-prone
   work (parsing CNXML, extracting and adversarially verifying the knowledge
   graph) happens once at build time with strong models, producing plain data.
   The runtime only *renders* and *traverses* that data. The one exception is
   the on-device LLM, whose outputs are always grounded in retrieved book
   blocks and clearly labeled as generated.
3. **Everything openly licensed.** Code (MIT), content (CC, per
   book), graph data (inherits the book's license as a derivative), and model
   weights (Apache-2.0/MIT). The tool itself is an argument: the 5Rs applied
   to an AI-powered learning environment.
4. **Nothing leaves the browser.** All inference is local (WebLLM/WebGPU); all
   user data (notes, highlights, chat history) is local storage. A student's
   questions — often the most revealing learning data there is — never touch a
   server. Privacy is a headline feature, not a side effect.
5. **Graceful degradation.** The reader and concept map work in any modern
   browser. Generative features use WebGPU when available and fall back to
   CPU (WASM) with a smaller model when it isn't — degraded, not absent. A
   book loaded without a graph.json still gets a full reader and page-grounded
   chat.
6. **The data is the interface.** The app renders `book.json` (from
   [openstax-convert](https://github.com/kalendar/openstax-convert)) and
   `graph.json` (from [openstax-graph](https://github.com/kalendar/openstax-graph))
   as-is. Any book anyone converts with those pipelines works here, unmodified.

## 3. Architecture overview

A static single-page application with three integrated views (Reader, Chat,
Concept Map) over two data artifacts, plus an inference layer:

- **Data artifacts:** `book.json` + `media/` (content store) and `graph.json`
  (knowledge graph). One reference book ships bundled; others load at runtime
  (§8).
- **Inference:** Transformers.js v4 (ONNX Runtime Web) running in a Web Worker
  so generation never blocks the UI, using the WebGPU backend where available
  and the WASM/CPU backend otherwise. Model weights download once from a
  public CDN (Hugging Face) and are cached locally — subsequent visits are
  fully offline-capable. The engine sits behind a thin internal interface
  (streaming chat completion + token counting) so it can be swapped without
  touching the features that use it (see §5, Alternatives considered).
- **User data:** highlights, notes, reading position, chat transcripts, and
  practice history in localStorage/IndexedDB, all exportable as JSON.
- **Integration spine:** block `anchor` ids and graph node ids are the shared
  currency. Chat citations, concept-map nodes, pathway steps, highlights, and
  practice questions all resolve to block anchors, so every feature can
  deep-link into the reader at paragraph granularity.

The three views are not tabs living side by side; they are three lenses on the
same identifiers, and the spec below treats cross-linking between them as core
functionality, not polish.

**Stack (all MIT/Apache-2.0/ISC):**

| Layer | Choice | Rationale |
|---|---|---|
| App framework | Svelte + SvelteKit (static adapter) | Compiles to plain JS with a ~10 KB runtime (2s load target, thumb-drive portability); no virtual-DOM overhead on block-heavy reader pages; stores fit the shared-anchor coordination across views; static adapter targets GitHub Pages directly; `.svelte` source reads like annotated HTML/CSS/JS — the lowest remix barrier for educators. Trade-off accepted: smaller contributor pool than React. |
| Concept map | Cytoscape.js (+ dagre, fcose layout extensions) | A graph-theory library, not just a renderer: its data model natively answers the queries the spec needs (ego neighborhoods, ancestor subgraphs, edge-type filtering); maintained layouts cover all three map views (dagre → prerequisite DAG, fcose → neighborhoods, concentric → ego); declarative stylesheets map onto edge-type/verified styling. Canvas rendering is comfortable at our dozens-to-low-hundreds node scale. |
| Inference | Transformers.js v4 (ONNX Runtime Web), in a Web Worker | See §5, including alternatives considered. |
| Math fallback | MathJax, self-hosted, lazy-loaded | See §4; loaded only when a book contains math and native MathML is inadequate. |

## 4. Component: Reader

Renders `book.json` directly.

**Navigation.** Sidebar table of contents from `toc[]` (chapter headings +
numbered sections); previous/next section controls following spine order;
URL routing to section and block (`#<anchor>`) so every paragraph is
addressable and shareable; reading position persisted locally.

**Section rendering.** Each section renders its ordered `blocks[]` using the
pre-cleaned `html` field; each block's `anchor` becomes its DOM id (scroll
target for citations, highlights, and deep links). Section header shows
`number`, `title`, and `objectives[]`. Figures resolve against the book's
`media/` base path. Math renders as native MathML first (now supported in all
evergreen browsers), with MathJax as a lazy-loaded fallback: the app scans the
loaded book for MathML content, and only when math is present *and* native
rendering is unavailable or defective does it fetch MathJax — so math-free
books (like the bundled reference book) never pay its weight. MathJax is
Apache-2.0 and self-hosted with the app (no CDN dependency), consistent with
free-forever and offline use. Block `trail` breadcrumbs orient the user inside long
sections.

**Concept awareness.** Glossary terms from the graph's concept vocabulary are
highlighted in the text of the section where they're *defined* (via `defines`
edges). Clicking a term opens a concept card: definition, "defined in"
link, related concepts (one hop of semantic edges), and a "view in concept
map" action. This is the primary bridge from reading into the graph.

**Prerequisite panel ("Before you read").** On section entry, traverse
`depends-on` edges from the concepts this section defines to concepts defined
in *earlier* sections; list them with their definitions and links. Pure DAG
traversal — no generation, no hallucination risk. Optionally dimmed for
concepts the user has already visited.

**Selection toolbar.** Selecting text in the reader offers: Explain this ·
Simplify this · Give me an example · Highlight · Add note. The first three
route to the chat (§5) with the selection plus its enclosing block as
context; the last two go to local annotations (§7).

**Attribution & licensing.** A persistent, visible license notice built from
`book.json`'s `title`, `publisher`, `license`, `license_url` — including a
one-click "copy attribution statement." NC and SA licenses are displayed
prominently when the book carries them. This is table stakes for an OER tool
and part of the demonstration.

## 5. Component: Chat (on-device Q&A)

**Engine.** Transformers.js v4 (Apache-2.0, Hugging Face), which runs any of
the thousands of pre-converted ONNX models on the Hugging Face Hub, with its
WebGPU backend for acceleration and its WASM/CPU backend as the automatic
fallback — one library covers both paths. The engine is wrapped in a thin
internal interface (streaming chat completion + token counting) so the app's
features never call the engine directly and a different engine can be swapped
in later.

**Alternatives considered (2026-07).**
- *WebLLM (MLC)* — the original plan and still the peak WebGPU decode-speed
  leader, with a clean OpenAI-compatible API. Rejected as the default because
  it is WebGPU-only (chat would vanish rather than degrade on unsupported
  browsers), custom models require compilation to MLC's own format (the
  weakest model-remix story of the candidates), and its model catalog and
  release cadence lag as a maintained-on-the-side academic project.
- *wllama (llama.cpp/WASM)* — MIT, loads any GGUF directly; GGUF is the most
  remix-friendly model format in existence. Rejected as the primary because it
  is CPU-only (~1B model ceiling for acceptable speed), but it remains the
  natural second engine behind the interface if we later want "bring your own
  GGUF."
- *Chrome built-in Prompt API (Gemini Nano)* — zero download, but Chrome-only,
  still behind flags/origin trial as of mid-2026, and the model is neither
  open nor redistributable. **Rejected on principle:** a closed, single-vendor
  model would contradict the project's central claim, even as an optional
  enhancement.

**Models.** A curated list of permissively licensed instruct models in ONNX
form — target the Qwen family (Apache-2.0) — in three tiers: sub-1B (CPU/WASM
path), ~1.7B quantized (default WebGPU), ~4B quantized (quality WebGPU).
Exact checkpoints chosen at build start from what's current; the constraint is
**permissive weights only** in the default list. Because the engine loads
arbitrary ONNX repos from the Hub, an advanced setting lets a user point at a
different model — the model layer is itself remixable. A settings panel shows
each model's license and download size before anything downloads, and
progress after.

**Adaptive model selection (capability probe).** On first use of a generative
feature, the app probes the device and *recommends* a (model, context-length)
pair rather than asking the user to guess:

1. **Signals.** WebGPU adapter presence and its reported limits
   (`maxBufferSize` / `maxStorageBufferBindingSize` as a coarse proxy for
   available GPU memory); `navigator.deviceMemory` (coarse, capped buckets)
   and `hardwareConcurrency` for the CPU path; Network Information API
   (`saveData`, `effectiveType`) to warn before a multi-GB download on a
   metered or slow connection.
2. **Context budgeting.** The chat's context need is computable from the data:
   system prompt + retrieved blocks (each ≤ the converter's token budget,
   default 2,500) + conversation history + generation headroom — roughly a
   4k–8k working window. All candidate models support this natively, so the
   real constraint is memory: KV-cache size grows linearly with context
   length, on top of the quantized weights. The probe picks the largest tier
   whose weights-plus-KV estimate fits the memory signals, then sets the
   engine's context window accordingly; a model that would fit only with a
   context too small for the grounding pipeline is excluded, never silently
   truncated.
3. **Verification.** After load, a short warm-up generation measures actual
   tokens/sec; below a usability floor, the app suggests stepping down a tier.
4. **Honesty and override.** Browsers deliberately blur hardware signals for
   privacy (`deviceMemory` caps at 8 GB; adapter limits are conservative), so
   this is a heuristic, presented as "Recommended for this device" with the
   detected signals shown, and always user-overridable from the model picker.
   The choice is remembered locally per device.

**Grounding pipeline (graph-assisted retrieval).** No embeddings, no extra
downloads — the graph *is* the retrieval index. (A note for later: since
Transformers.js also runs embedding models natively, a semantic-search
upgrade would need no second engine — a small build-time index plus a
~30 MB embedding model. Out of scope for the PoC, but the door is open.)

1. **Concept matching.** Match the user's question against the fixed concept
   vocabulary (glossary terms), with normalization (case, plurals/stemming)
   and multi-word term detection.
2. **Edge traversal.** For matched concepts, follow `defines` edges (highest
   priority) and `mentions` edges to candidate sections. If nothing matches,
   fall back to the currently open section.
3. **Ranking.** Prefer: the section currently open in the reader → sections
   that *define* a matched concept → sections that mention it, weighted by
   edge `weight` when present and by number of distinct matched concepts.
4. **Block selection.** From the top-ranked sections, select blocks (using
   their `text` field and `tokens` estimates) until the context budget is
   filled; the definition block of a matched concept is always included.
5. **Prompting.** System prompt instructs the model to answer *only* from the
   provided passages, to say so when they don't contain the answer, and to
   cite passages by their anchors.

**Answer presentation.** Streaming responses; citations render as clickable
references that scroll the reader to the cited block and flash-highlight it. A
collapsible "Grounded on these passages" panel shows exactly what the model
saw — transparency about the retrieval is part of the pedagogy and part of
the demo.

**Conversation.** Multi-turn with the retrieval step re-run per question;
history stored locally, clearable, exportable. A standing, non-alarmist notice
that answers are machine-generated and the cited passages are the authority.

**Degradation.** On browsers without WebGPU, the engine drops to its WASM/CPU
backend with the small default model, and the UI says so ("running in
compatibility mode — slower, simpler answers"). If even WASM inference is
unavailable or the user declines the download, the chat pane explains what's
missing; everything else functions normally. If the loaded book has no
`graph.json`, retrieval degrades to current-section grounding automatically.

## 6. Component: Concept Map Explorer

Renders `graph.json` directly.

**Views.**
- **Neighborhood view (default):** ego-graph around a selected concept —
  its semantic edges (`is-a`, `part-of`, `depends-on`, `contrasts-with`,
  `related-to`) and the entities that `illustrate` it. Opening the map from a
  reader section centers it on that section's defined concepts.
- **Chapter view:** all concepts of one chapter and the edges among them.
- **Prerequisite view:** the `depends-on` DAG rendered with a layered/
  hierarchical layout (it's guaranteed acyclic), filterable to the ancestors
  or descendants of a chosen concept.

Full-book hairball views are explicitly avoided; a book has hundreds of
concepts and thousands of edges, and the chapter/ego scoping is what keeps the
map legible.

**Interaction.** Search-as-you-type over terms and entity names; edge-type
legend with toggles; visual distinction of node kinds (concept / entity /
section) and structural vs. semantic edges, with `verified` semantic edges
badged as adversarially verified — surfacing the trustworthiness story.
Selecting a node opens a detail panel: definition, chapter, `defined_in` link
into the reader, and per-edge `evidence` text where present. Every
concept↔section connection is a two-way door between map and reader.

## 7. Generative & study features

**Learning pathways.** "Show me the path to understanding X": compute the
prerequisite ancestor subgraph of concept X, topologically order it, and
present it as an ordered reading list — each step a concept, its definition,
and its defining section link. Rendered both as a list and as a subgraph in the
prerequisite view. Traversal only; no generation.

**Practice questions.** From the current section, the on-device model
generates self-check questions grounded on that section's blocks — multiple-choice and short-answer.
For short answers, the model evaluates the user's response against the source
block and gives feedback that cites it. Each question links to the block it was
generated from ("show me where this is covered"). Practice history is local.
Labeled clearly as machine-generated.

**Explain-selected-text.** The reader's selection toolbar (§4) sends the
selection, its enclosing block, and its `trail` to the chat with an
explain/simplify/exemplify instruction; the response appears in the chat pane
as a normal grounded, cited answer.

**Highlights & notes.** Highlights anchor to `(block anchor, start offset,
end offset)`; notes attach to a highlight or a whole block. Stored locally;
export/import as a single JSON file — which is *Retain*, demonstrated: the
user owns and can move their annotation layer independently of the app.

## 8. Book loading

- **Bundled reference book:** OpenStax *Entrepreneurship* (CC BY-NC-SA 4.0;
  both pipelines are validated on it), with its pre-built, verified
  `graph.json`. The demo works instantly with zero configuration. Because the
  reference book carries NC and SA terms, the attribution UI (§4) must surface
  them prominently — which usefully demonstrates that part of the design.
- **Load your own:** (a) a URL parameter pointing at a directory containing
  `book.json` (+ optional `graph.json`, `media/`) on any static host, and
  (b) local file/folder or zip drop, processed entirely in-browser.
- **Validation:** structural checks on load with specific, human-readable
  errors ("sections[3] has no blocks"), plus cross-checks when a graph is
  present (concept `defined_in` ids resolve to real sections). Missing graph
  ⇒ map, pathways, and concept highlighting disable; chat falls back to
  page grounding. Missing media ⇒ figures show alt text (which the converter
  already folds into block text, so chat is unaffected).
- **Per-book user data:** annotations and history are keyed by book `slug` so
  multiple loaded books don't collide.

This loader is what makes the tool infrastructure rather than a single demo:
anyone can run `/openstax-convert` + `/openstax-graph` on another OpenStax
title, host the output anywhere static, and point this reader at it.

## 9. The 5R layer (making the openness legible)

The PoC should *demonstrate* the 5Rs, not just permit them:

- **About/Remix page:** plainly explains the full stack — where the content
  came from, how the JSON was produced (links to both pipeline repos), what
  the graph is and how it was verified, what model is running and under what
  license — with a "make your own" walkthrough.
- **View the data:** every reader page offers "view this section's JSON"; the
  map offers "view this node/edge"; global downloads for `book.json` and
  `graph.json`. The artifacts users would remix are one click away.
- **Retain:** one-button export of everything local (annotations, chat,
  practice history) as JSON.
- **Redistribute/Reuse:** the app is a fork-able static repo; "Fork on GitHub"
  is in the footer. Deployment is documented as "fork, enable Pages."
- **Attribution:** auto-generated attribution statements for the book (per its
  license) and for the app itself.

## 10. Non-functional requirements

- **Cost:** $0 to host (static), $0 to run (client-side inference), $0 to use.
  No API keys anywhere. Model weights served from Hugging Face's public CDN
  (Transformers.js's default source).
- **Offline:** installable PWA; after first visit (and model download), the
  bundled book, graph, and chat work with no connection. Relevant to exactly
  the low-connectivity contexts OER serves.
- **Performance targets:** app shell + book.json interactive in ≤ 2s on a
  mid-range laptop; media lazy-loaded per section; model download (order of
  1–3 GB depending on choice) is opt-in, shown with size and progress, cached
  permanently; generation streams.
- **Browser support:** reader + map on all evergreen browsers, desktop and
  mobile. Generative features run accelerated on WebGPU (current Chrome/Edge,
  Safari 26+, recent Firefox) and fall back to WASM/CPU with a smaller model
  elsewhere; capability-detected at runtime with honest messaging.
- **Accessibility:** semantic HTML from the converter preserved; figure alt
  text already in the data; full keyboard navigation; the concept map gets a
  list-view equivalent (node detail + edge lists) so the graph's content is
  never canvas-only; WCAG 2.1 AA as the bar.
- **Privacy:** no analytics, no telemetry, no cookies, no network calls after
  asset load except the model CDN fetch. Stated plainly in the UI.

## 11. Licensing

| Layer | License | Notes |
|---|---|---|
| Application code | MIT (decided 2026-07-11; LICENSE in repo) | Fork-and-remix friendly |
| Content (`book.json`, media) | Per book; reference book CC BY-NC-SA 4.0 | Carried through from the collection by the converter; NC/SA surfaced in UI |
| Graph (`graph.json`) | Same as its source book | Derivative of the content |
| Pipelines | Per kalendar/openstax-convert and kalendar/openstax-graph repos | Linked from About page |
| Model weights | Apache-2.0 or MIT only (default list) | The openness claim extends to the model |
| Inference engine (Transformers.js v4 + ONNX Runtime Web) | Apache-2.0 | |

## 12. Out of scope for the PoC

Accounts and cross-device sync; LMS/LTI integration; learning analytics;
an authoring/editing UI for the content itself (remixing happens upstream in
the pipelines); server-side or API-based inference fallback; non-OpenStax
ingestion formats; a teacher-facing course-planning view of the prerequisite
DAG (a promising fast-follow, deliberately deferred).

## 13. Suggested build milestones

1. **Reader** rendering the bundled book end-to-end (TOC, sections, figures,
   anchors, attribution).
2. **Concept map** (neighborhood + chapter + prerequisite views) with two-way
   reader linking, plus the "Before you read" panel.
3. **Chat** (Transformers.js worker behind the engine interface, model picker,
   graph-assisted retrieval, cited streaming answers, WebGPU→WASM fallback).
4. **Study features** (pathways, practice questions, explain-selection,
   highlights/notes with export).
5. **Loader, PWA/offline, 5R layer, a11y pass, polish.**

Milestones 1–2 require no LLM at all and are demoable early; each milestone is
independently shippable.

## 14. Decision log & remaining open items

Settled (2026-07-08): name **GenOER Reader**; content strategy **bundled
reference book + load-your-own**; model weights **permissive licenses only**;
grounding **graph-assisted retrieval**; all four study features **in scope**;
engine **Transformers.js v4** behind a swappable interface (WebLLM and the
Chrome Prompt API considered and rejected — see §5); model choice **adaptive
via capability probe** (§5); framework **Svelte/SvelteKit**; concept map
**Cytoscape.js**; **MathJax fallback in**; **teacher view deferred** (§12).

Remaining open items (deferrable to build time):
1. **Exact model checkpoints** for the three tiers — RESOLVED during the build:
   Qwen3-0.6B (q4f16 WebGPU / q4 CPU) + Qwen3-4B, on transformers.js pinned to
   ^3.7.1 (see the registry's comments and /dev/engine-test for the constraints
   discovered in field debugging).
2. **Visual design language** — not specified here; worth a lightweight pass
   before milestone 1 so the reader feels like a book, not an app.
3. **Repo home** — RESOLVED (2026-07-09): https://github.com/kalendar/genoer-reader.
