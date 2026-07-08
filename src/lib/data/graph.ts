/**
 * Data layer for the GenOER Reader's knowledge graph (SPEC.md §6, the
 * Concept Map Explorer, plus the reader's "Before you read" panel and
 * glossary-term cards in §4).
 *
 * Mirrors `$lib/data/book.ts`'s shape: a thin fetch+validate loader plus a
 * set of pure, side-effect-free query helpers over an in-memory index. The
 * graph is *optional* — a book without a `graph.json` must leave the reader
 * fully functional (SPEC.md §2 principle 5, §8). `loadGraph` therefore never
 * throws; on any failure it warns to the console and resolves `null`, and
 * every helper here is written to be called only once a non-null
 * `GraphIndex` exists (callers should branch on that at the UI layer — see
 * `$lib/stores/graph.ts`).
 */

/** A glossary/concept vocabulary node, e.g. "concept:due-diligence". */
export interface ConceptNode {
	id: string;
	term: string;
	definition: string;
	chapter: number | null;
	/** Module id (matches `Section.id` in `$lib/data/book.ts`) of the section that defines this concept. */
	defined_in: string;
}

/** A named real-world entity the graph tracks mentions of, e.g. "entity:evernote". */
export interface EntityNode {
	id: string;
	name: string;
	/** Number of sections (or mentions) the entity appears in, per the graph builder. */
	count: number;
}

/** A reading-spine node mirroring one `Section` from `$lib/data/book.ts`. */
export interface SectionNode {
	id: string;
	/** Module id — matches `Section.id` in `$lib/data/book.ts` and `ConceptNode.defined_in`. */
	module: string;
	number: string | null;
	title: string;
	chapter: number | null;
}

export type NodeKind = 'concept' | 'entity' | 'section';

/** A `ConceptNode`/`EntityNode`/`SectionNode` tagged with which of the three it is, for code that
 * needs to handle graph nodes generically (search results, canvas elements, list-view rows). */
export type GraphNode =
	| ({ kind: 'concept' } & ConceptNode)
	| ({ kind: 'entity' } & EntityNode)
	| ({ kind: 'section' } & SectionNode);

/** Structural edges describe the book's own scaffolding (authored, not inferred). */
export const STRUCTURAL_EDGE_TYPES = ['defines', 'mentions', 'appears_in', 'cross_ref', 'precedes'] as const;
/** Semantic edges are build-time-extracted and adversarially verified (SPEC.md §1/§6); every
 * semantic edge in `graph.json` carries `verified: true`. */
export const SEMANTIC_EDGE_TYPES = [
	'is-a',
	'part-of',
	'contrasts-with',
	'depends-on',
	'related-to',
	'illustrates'
] as const;

export type StructuralEdgeType = (typeof STRUCTURAL_EDGE_TYPES)[number];
export type SemanticEdgeType = (typeof SEMANTIC_EDGE_TYPES)[number];
export type EdgeType = StructuralEdgeType | SemanticEdgeType;

export interface GraphEdge {
	type: EdgeType;
	source: string;
	target: string;
	evidence?: string;
	weight?: number;
	/** e.g. "cross-chapter" on some `depends-on` edges; absent means within-chapter. */
	scope?: string;
	verified?: boolean;
}

export interface GraphData {
	book: string;
	stage: string;
	nodes: {
		concepts: ConceptNode[];
		entities: EntityNode[];
		sections: SectionNode[];
	};
	edges: GraphEdge[];
}

/** Where a book's `graph.json` lives, given its slug (parallels `bookUrl` in `$lib/data/book.ts`). */
export function graphUrl(slug: string): string {
	return `/books/${slug}/graph.json`;
}

class GraphValidationError extends Error {}

function validateGraph(data: unknown, slug: string): asserts data is GraphData {
	if (!data || typeof data !== 'object') {
		throw new GraphValidationError(`Graph "${slug}": graph.json is not an object`);
	}
	const graph = data as Partial<GraphData>;
	if (!graph.nodes || typeof graph.nodes !== 'object') {
		throw new GraphValidationError(`Graph "${slug}": missing "nodes"`);
	}
	for (const key of ['concepts', 'entities', 'sections'] as const) {
		if (!Array.isArray(graph.nodes[key])) {
			throw new GraphValidationError(`Graph "${slug}": "nodes.${key}" is not an array`);
		}
	}
	if (!Array.isArray(graph.edges)) {
		throw new GraphValidationError(`Graph "${slug}": "edges" is not an array`);
	}
}

/** In-memory cache of in-flight/completed graph loads, keyed by slug (parallels `bookCache`). */
const graphCache = new Map<string, Promise<GraphData | null>>();

/**
 * Load and validate a book's `graph.json` by slug. Never throws: a missing or malformed graph is
 * a supported, expected state (SPEC.md §8 "missing graph ⇒ map, pathways, and concept highlighting
 * disable"), so this resolves `null` on any failure (404, network error, bad shape) and warns to
 * the console rather than breaking the caller. Pass the `fetch` from a SvelteKit `load` event when
 * calling this from a `load` function.
 */
export function loadGraph(slug: string, fetchImpl: typeof fetch = fetch): Promise<GraphData | null> {
	let cached = graphCache.get(slug);
	if (!cached) {
		cached = (async () => {
			try {
				const res = await fetchImpl(graphUrl(slug));
				if (!res.ok) {
					if (res.status !== 404) {
						console.warn(`Graph "${slug}": HTTP ${res.status} loading graph.json — map disabled for this book.`);
					}
					return null;
				}
				const data = await res.json();
				validateGraph(data, slug);
				return data;
			} catch (err) {
				console.warn(`Graph "${slug}": failed to load/parse graph.json — map disabled for this book.`, err);
				return null;
			}
		})();
		graphCache.set(slug, cached);
	}
	return cached;
}

// ---------------------------------------------------------------------------
// Index: build once per loaded graph, then query it with the pure helpers
// below. Everything here is read-only over the maps built in `buildGraphIndex`.
// ---------------------------------------------------------------------------

export interface GraphIndex {
	data: GraphData;

	nodeById: Map<string, GraphNode>;
	conceptsById: Map<string, ConceptNode>;
	entitiesById: Map<string, EntityNode>;
	sectionsById: Map<string, SectionNode>;
	/** Keyed by module id (e.g. "m71114"), matching `Section.id` in `$lib/data/book.ts` and
	 * `ConceptNode.defined_in` — the join key between book and graph. */
	sectionByModule: Map<string, SectionNode>;
	/** Reading-spine position of each section, by module id. Lower = earlier in the book. */
	sectionOrder: Map<string, number>;

	edgesBySource: Map<string, GraphEdge[]>;
	edgesByTarget: Map<string, GraphEdge[]>;
	edgesByType: Map<EdgeType, GraphEdge[]>;

	conceptsByChapter: Map<number, ConceptNode[]>;
	/** Concepts `defines`-edged to a section, by that section's module id. */
	conceptsDefinedInSection: Map<string, ConceptNode[]>;

	/** All distinct chapter numbers with at least one concept, ascending. */
	chapters: number[];
}

export function buildGraphIndex(data: GraphData): GraphIndex {
	const nodeById = new Map<string, GraphNode>();
	const conceptsById = new Map<string, ConceptNode>();
	const entitiesById = new Map<string, EntityNode>();
	const sectionsById = new Map<string, SectionNode>();
	const sectionByModule = new Map<string, SectionNode>();
	const sectionOrder = new Map<string, number>();

	for (const c of data.nodes.concepts) {
		conceptsById.set(c.id, c);
		nodeById.set(c.id, { kind: 'concept', ...c });
	}
	for (const e of data.nodes.entities) {
		entitiesById.set(e.id, e);
		nodeById.set(e.id, { kind: 'entity', ...e });
	}
	data.nodes.sections.forEach((s, i) => {
		sectionsById.set(s.id, s);
		sectionByModule.set(s.module, s);
		sectionOrder.set(s.module, i);
		nodeById.set(s.id, { kind: 'section', ...s });
	});

	const edgesBySource = new Map<string, GraphEdge[]>();
	const edgesByTarget = new Map<string, GraphEdge[]>();
	const edgesByType = new Map<EdgeType, GraphEdge[]>();
	for (const edge of data.edges) {
		pushInto(edgesBySource, edge.source, edge);
		pushInto(edgesByTarget, edge.target, edge);
		pushInto(edgesByType, edge.type, edge);
	}

	const conceptsByChapter = new Map<number, ConceptNode[]>();
	for (const c of data.nodes.concepts) {
		if (c.chapter == null) continue;
		pushInto(conceptsByChapter, c.chapter, c);
	}

	const conceptsDefinedInSection = new Map<string, ConceptNode[]>();
	for (const edge of edgesByType.get('defines') ?? []) {
		const concept = conceptsById.get(edge.source);
		const section = sectionsById.get(edge.target);
		if (!concept || !section) continue;
		pushInto(conceptsDefinedInSection, section.module, concept);
	}

	const chapters = [...conceptsByChapter.keys()].sort((a, b) => a - b);

	return {
		data,
		nodeById,
		conceptsById,
		entitiesById,
		sectionsById,
		sectionByModule,
		sectionOrder,
		edgesBySource,
		edgesByTarget,
		edgesByType,
		conceptsByChapter,
		conceptsDefinedInSection,
		chapters
	};
}

function pushInto<K, V>(map: Map<K, V[]>, key: K, value: V): void {
	const list = map.get(key);
	if (list) list.push(value);
	else map.set(key, [value]);
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export function getNode(index: GraphIndex, id: string): GraphNode | undefined {
	return index.nodeById.get(id);
}

/** Concepts this section `defines` (SPEC.md §4 "Concept awareness" / §6 defines edges). */
export function conceptsBySection(index: GraphIndex, sectionModuleId: string): ConceptNode[] {
	return index.conceptsDefinedInSection.get(sectionModuleId) ?? [];
}

/** Sections a concept is connected to, split by edge type — the two-way door back to the reader. */
export function sectionsForConcept(
	index: GraphIndex,
	conceptId: string
): { defines: SectionNode[]; mentions: SectionNode[] } {
	const defines: SectionNode[] = [];
	const mentions: SectionNode[] = [];
	for (const edge of index.edgesBySource.get(conceptId) ?? []) {
		if (edge.type !== 'defines' && edge.type !== 'mentions') continue;
		const section = index.sectionsById.get(edge.target);
		if (!section) continue;
		(edge.type === 'defines' ? defines : mentions).push(section);
	}
	return { defines, mentions };
}

export interface Subgraph {
	nodes: GraphNode[];
	edges: GraphEdge[];
}

const EGO_EDGE_TYPES = new Set<EdgeType>([
	'is-a',
	'part-of',
	'contrasts-with',
	'depends-on',
	'related-to'
]);

/**
 * Ego-graph around a concept (SPEC.md §6 "Neighborhood view"): BFS out to `depth` hops over
 * semantic concept↔concept edges (undirected — a prerequisite, a contrast, and a specialization
 * are all "neighbors" for browsing purposes), plus every entity that `illustrates` a concept
 * pulled into the neighborhood.
 */
export function egoNeighborhood(index: GraphIndex, conceptId: string, depth = 1): Subgraph {
	const center = index.conceptsById.get(conceptId);
	if (!center) return { nodes: [], edges: [] };

	const visited = new Set<string>([conceptId]);
	let frontier = [conceptId];
	const edgeSet = new Map<string, GraphEdge>();

	for (let d = 0; d < depth; d++) {
		const next: string[] = [];
		for (const id of frontier) {
			const touching = [...(index.edgesBySource.get(id) ?? []), ...(index.edgesByTarget.get(id) ?? [])];
			for (const edge of touching) {
				if (!EGO_EDGE_TYPES.has(edge.type)) continue;
				const other = edge.source === id ? edge.target : edge.source;
				if (!index.conceptsById.has(other)) continue;
				edgeSet.set(edgeKey(edge), edge);
				if (!visited.has(other)) {
					visited.add(other);
					next.push(other);
				}
			}
		}
		frontier = next;
		if (frontier.length === 0) break;
	}

	const nodes: GraphNode[] = [...visited]
		.map((id) => index.nodeById.get(id))
		.filter((n): n is GraphNode => !!n);

	// Pull in entities that illustrate any concept now in the neighborhood.
	for (const id of visited) {
		for (const edge of index.edgesByTarget.get(id) ?? []) {
			if (edge.type !== 'illustrates') continue;
			const entity = index.entitiesById.get(edge.source);
			if (!entity) continue;
			edgeSet.set(edgeKey(edge), edge);
			if (!visited.has(entity.id)) {
				visited.add(entity.id);
				nodes.push({ kind: 'entity', ...entity });
			}
		}
	}

	return { nodes, edges: [...edgeSet.values()] };
}

function edgeKey(edge: GraphEdge): string {
	return `${edge.type} ${edge.source} ${edge.target}`;
}

/**
 * Transitive closure of `depends-on` edges *from* `conceptId` (i.e. everything `conceptId`
 * requires, directly or indirectly). The DAG is guaranteed acyclic (SPEC.md §6), so plain BFS
 * with a visited set is sufficient — no cycle guard needed, though one costs nothing.
 */
export function prerequisiteAncestors(index: GraphIndex, conceptId: string): ConceptNode[] {
	return traverseDependsOn(index, conceptId, index.edgesBySource, (e) => e.target);
}

/** Transitive closure of `depends-on` edges *into* `conceptId` (everything that requires it). */
export function prerequisiteDescendants(index: GraphIndex, conceptId: string): ConceptNode[] {
	return traverseDependsOn(index, conceptId, index.edgesByTarget, (e) => e.source);
}

function traverseDependsOn(
	index: GraphIndex,
	startId: string,
	edgesByEnd: Map<string, GraphEdge[]>,
	pick: (edge: GraphEdge) => string
): ConceptNode[] {
	const visited = new Set<string>([startId]);
	const result: ConceptNode[] = [];
	let frontier = [startId];
	while (frontier.length > 0) {
		const next: string[] = [];
		for (const id of frontier) {
			for (const edge of edgesByEnd.get(id) ?? []) {
				if (edge.type !== 'depends-on') continue;
				const other = pick(edge);
				if (visited.has(other)) continue;
				visited.add(other);
				const concept = index.conceptsById.get(other);
				if (concept) {
					result.push(concept);
					next.push(other);
				}
			}
		}
		frontier = next;
	}
	return result;
}

/** The `depends-on` edges connecting a set of concept ids to each other (for rendering a
 * prerequisite subgraph once its node set — ancestors, descendants, a chapter, etc. — is known). */
export function dependsOnEdgesAmong(index: GraphIndex, conceptIds: Iterable<string>): GraphEdge[] {
	const ids = new Set(conceptIds);
	const edges = index.edgesByType.get('depends-on') ?? [];
	return edges.filter((e) => ids.has(e.source) && ids.has(e.target));
}

/** The whole `depends-on` DAG: every concept that participates in at least one prerequisite edge,
 * plus those edges. This is the Prerequisite view's un-filtered default — small enough (dozens to
 * low hundreds of nodes even on a full book) to never be the "whole-book hairball" SPEC.md §6 warns
 * against, since only a minority of concepts carry explicit prerequisite relationships. */
export function fullPrerequisiteDag(index: GraphIndex): Subgraph {
	const edges = index.edgesByType.get('depends-on') ?? [];
	const ids = new Set<string>();
	for (const e of edges) {
		ids.add(e.source);
		ids.add(e.target);
	}
	const nodes = [...ids].map((id) => index.nodeById.get(id)).filter((n): n is GraphNode => !!n);
	return { nodes, edges };
}

/**
 * Ordered "pathway to understanding X": the prerequisite ancestor subgraph of `conceptId`,
 * topologically sorted (prerequisites-first) with `conceptId` itself last (SPEC.md §7 "Learning
 * pathways" — traversal only, no generation). Exposed here as groundwork for that later study
 * feature: it needs exactly this ordering, plus each step's defining section for the reading-list
 * link, both of which this returns directly.
 */
export function prerequisitePathway(
	index: GraphIndex,
	conceptId: string
): { concept: ConceptNode; section: SectionNode | undefined }[] {
	const target = index.conceptsById.get(conceptId);
	if (!target) return [];
	const ancestors = prerequisiteAncestors(index, conceptId);
	const ids = new Set([...ancestors.map((c) => c.id), conceptId]);
	const edges = dependsOnEdgesAmong(index, ids);
	const order = topologicalOrder([...ids], edges);
	return order.map((id) => ({
		concept: index.conceptsById.get(id)!,
		section: index.sectionByModule.get(index.conceptsById.get(id)!.defined_in)
	}));
}

/**
 * Kahn's-algorithm topological sort of `nodeIds` given `edges` where an edge `source -> target`
 * means "source depends on target" (target must come first). Generic over any depends-on-shaped
 * edge list — reused by `prerequisitePathway` and available directly for the pathways feature
 * (SPEC.md §7) if it needs to order a differently-scoped subgraph.
 */
export function topologicalOrder(nodeIds: string[], edges: { source: string; target: string }[]): string[] {
	const inDegree = new Map<string, number>(nodeIds.map((id) => [id, 0]));
	const dependents = new Map<string, string[]>(); // target -> [source, ...] ("comes after target")
	for (const { source, target } of edges) {
		if (!inDegree.has(source) || !inDegree.has(target)) continue;
		inDegree.set(source, (inDegree.get(source) ?? 0) + 1);
		pushInto(dependents, target, source);
	}
	const queue = nodeIds.filter((id) => inDegree.get(id) === 0);
	const result: string[] = [];
	while (queue.length > 0) {
		const id = queue.shift()!;
		result.push(id);
		for (const dep of dependents.get(id) ?? []) {
			const remaining = (inDegree.get(dep) ?? 1) - 1;
			inDegree.set(dep, remaining);
			if (remaining === 0) queue.push(dep);
		}
	}
	// A cycle (shouldn't happen — the depends-on DAG is verified acyclic) would leave nodes out of
	// `result`; append anything missed rather than silently dropping it.
	if (result.length < nodeIds.length) {
		const seen = new Set(result);
		for (const id of nodeIds) if (!seen.has(id)) result.push(id);
	}
	return result;
}

/** All concepts of one chapter, and the edges directly among them (SPEC.md §6 "Chapter view"). Edge
 * set spans both semantic (concept relationships) and structural `cross_ref`-via-section is
 * intentionally excluded — chapter view is concept-to-concept, not concept-to-section. */
export function chapterSubgraph(index: GraphIndex, chapter: number): Subgraph {
	const concepts = index.conceptsByChapter.get(chapter) ?? [];
	const ids = new Set(concepts.map((c) => c.id));
	const edges = index.data.edges.filter(
		(e) => SEMANTIC_EDGE_TYPES.includes(e.type as SemanticEdgeType) && ids.has(e.source) && ids.has(e.target)
	);
	const nodes: GraphNode[] = concepts.map((c) => ({ kind: 'concept', ...c }));
	return { nodes, edges };
}

export interface SearchResult {
	node: GraphNode;
	label: string;
}

/** Search-as-you-type over concept terms and entity names (SPEC.md §6). Case-insensitive substring
 * match, terms ranked before entities, then by where the match falls (prefix beats mid-string),
 * then alphabetically. */
export function searchNodes(index: GraphIndex, query: string, limit = 20): SearchResult[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	const results: (SearchResult & { rank: number; pos: number })[] = [];
	for (const c of index.data.nodes.concepts) {
		const pos = c.term.toLowerCase().indexOf(q);
		if (pos === -1) continue;
		results.push({ node: { kind: 'concept', ...c }, label: c.term, rank: 0, pos });
	}
	for (const e of index.data.nodes.entities) {
		const pos = e.name.toLowerCase().indexOf(q);
		if (pos === -1) continue;
		results.push({ node: { kind: 'entity', ...e }, label: e.name, rank: 1, pos });
	}
	results.sort((a, b) => a.rank - b.rank || a.pos - b.pos || a.label.localeCompare(b.label));
	return results.slice(0, limit).map(({ node, label }) => ({ node, label }));
}

/** Semantic edges (both directions) touching a concept, one hop — used for the reader's glossary
 * concept card "related concepts" (SPEC.md §4). */
export function relatedConcepts(index: GraphIndex, conceptId: string): { concept: ConceptNode; edge: GraphEdge }[] {
	const touching = [...(index.edgesBySource.get(conceptId) ?? []), ...(index.edgesByTarget.get(conceptId) ?? [])];
	const out: { concept: ConceptNode; edge: GraphEdge }[] = [];
	const seen = new Set<string>();
	for (const edge of touching) {
		if (!SEMANTIC_EDGE_TYPES.includes(edge.type as SemanticEdgeType) || edge.type === 'illustrates') continue;
		const otherId = edge.source === conceptId ? edge.target : edge.source;
		const concept = index.conceptsById.get(otherId);
		if (!concept || seen.has(concept.id)) continue;
		seen.add(concept.id);
		out.push({ concept, edge });
	}
	return out;
}

/** True if `moduleA`'s section comes strictly before `moduleB`'s in reading order. Unknown modules
 * sort as "not earlier" (fail closed — an unresolvable section never counts as a prerequisite). */
export function isEarlierSection(index: GraphIndex, moduleA: string, moduleB: string): boolean {
	const a = index.sectionOrder.get(moduleA);
	const b = index.sectionOrder.get(moduleB);
	if (a == null || b == null) return false;
	return a < b;
}
