import type cytoscape from 'cytoscape';
import type { GraphNode, GraphEdge, EdgeType } from '$lib/data/graph';

/** Display label for a graph node, independent of which of the three shapes it is. */
export function nodeLabel(node: GraphNode): string {
	if (node.kind === 'concept') return node.term;
	if (node.kind === 'entity') return node.name;
	return node.title;
}

/**
 * Convert a `{ nodes, edges }` subgraph (as returned by `$lib/data/graph`'s view helpers) into
 * Cytoscape element definitions. Drops any edge whose endpoint isn't in `nodes` (defensive — the
 * graph helpers shouldn't produce dangling edges, but a canvas renderer should never crash on one).
 *
 * `reverseTypes` flips an edge's Cytoscape source/target (but not its `data.type`/evidence, which
 * keep the original graph-edge wording) — used for the Prerequisite view, where `depends-on` reads
 * "A depends on B" but a top-to-bottom layered layout should draw B (the prerequisite) above A (the
 * thing that needs it), i.e. the arrow should point in reading order, not dependency-declaration order.
 */
export function buildElements(
	nodes: GraphNode[],
	edges: GraphEdge[],
	opts: { reverseTypes?: Set<EdgeType> } = {}
): cytoscape.ElementDefinition[] {
	const nodeIds = new Set(nodes.map((n) => n.id));
	const reverse = opts.reverseTypes ?? new Set();

	const nodeEls: cytoscape.ElementDefinition[] = nodes.map((n) => ({
		data: {
			id: n.id,
			label: nodeLabel(n),
			kind: n.kind,
			chapter: 'chapter' in n ? n.chapter : null
		}
	}));

	const edgeEls: cytoscape.ElementDefinition[] = edges
		.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
		.map((e) => {
			const flip = reverse.has(e.type);
			return {
				data: {
					id: `${e.type}|${e.source}|${e.target}`,
					source: flip ? e.target : e.source,
					target: flip ? e.source : e.target,
					type: e.type,
					verified: e.verified ? 'true' : 'false',
					evidence: e.evidence ?? '',
					scope: e.scope ?? ''
				}
			};
		});

	return [...nodeEls, ...edgeEls];
}
