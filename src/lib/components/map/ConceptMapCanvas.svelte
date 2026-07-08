<script lang="ts">
	import { onMount } from 'svelte';
	import type cytoscape from 'cytoscape';

	let {
		elements,
		layoutName,
		centerIds = [],
		selectedId = null,
		onSelect
	}: {
		elements: cytoscape.ElementDefinition[];
		layoutName: 'concentric' | 'fcose' | 'dagre';
		/** For `concentric` layout: BFS levels are measured from these (usually one node, but
		 * "open this section's concepts in the map" seeds several at once). Also permanently
		 * badged with the `.map-center` style, independent of the (separate) click-to-select
		 * `selectedId`. */
		centerIds?: string[];
		selectedId?: string | null;
		onSelect: (id: string | null) => void;
	} = $props();

	let container: HTMLDivElement | undefined = $state();
	let cy: cytoscape.Core | undefined;
	let ready = $state(false);
	let extensionsRegistered = false;
	/** True once `runLayout` has completed a fit against a real (nonzero) container size — see the
	 * ResizeObserver in `onMount` and the comment in `runLayout`. */
	let hasFit = false;

	function readColor(name: string): string {
		if (typeof window === 'undefined') return '#888888';
		return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888888';
	}

	function buildStylesheet(): cytoscape.StylesheetJson {
		const c = {
			concept: readColor('--map-node-concept'),
			entity: readColor('--map-node-entity'),
			section: readColor('--map-node-section'),
			bgRaised: readColor('--color-bg-raised'),
			text: readColor('--color-text'),
			textMuted: readColor('--color-text-muted'),
			accent: readColor('--color-accent'),
			border: readColor('--color-border'),
			dependsOn: readColor('--map-edge-depends-on'),
			isA: readColor('--map-edge-is-a'),
			relatedTo: readColor('--map-edge-related-to'),
			partOf: readColor('--map-edge-part-of'),
			contrastsWith: readColor('--map-edge-contrasts-with'),
			illustrates: readColor('--map-edge-illustrates'),
			structural: readColor('--map-edge-structural')
		};

		return [
			{
				selector: 'node',
				style: {
					label: 'data(label)',
					'font-size': 10,
					// Cytoscape's stylesheet values are plain CSS-like strings but don't resolve custom
					// properties (`var(...)`) — unlike the colors above (read via getComputedStyle), this
					// has to be a literal font stack. Matches `--font-ui` in app.css.
					'font-family': "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
					color: c.text,
					'text-valign': 'bottom',
					'text-margin-y': 6,
					'text-wrap': 'wrap',
					'text-max-width': '90px',
					width: 26,
					height: 26,
					'background-color': c.concept,
					'border-width': 0
				}
			},
			{ selector: 'node[kind="concept"]', style: { shape: 'ellipse', 'background-color': c.concept } },
			{ selector: 'node[kind="entity"]', style: { shape: 'diamond', 'background-color': c.entity, width: 22, height: 22 } },
			{
				selector: 'node[kind="section"]',
				style: {
					shape: 'round-rectangle',
					'background-color': c.bgRaised,
					'border-width': 2,
					'border-color': c.section,
					width: 36,
					height: 22,
					'font-style': 'italic',
					color: c.textMuted
				}
			},
			{
				selector: 'node.map-selected',
				style: { 'border-width': 4, 'border-color': c.accent, 'border-style': 'solid' }
			},
			{
				selector: 'node.map-center',
				style: { 'border-width': 4, 'border-color': c.accent, width: 36, height: 36, 'font-weight': 'bold' }
			},
			{
				selector: 'edge',
				style: {
					width: 2,
					'curve-style': 'bezier',
					'line-color': c.structural,
					'target-arrow-shape': 'none',
					'line-style': 'dashed',
					opacity: 0.9
				}
			},
			{
				selector: 'edge[type = "depends-on"]',
				style: {
					'line-color': c.dependsOn,
					'target-arrow-color': c.dependsOn,
					'target-arrow-shape': 'triangle',
					'line-style': 'solid',
					width: 2.5
				}
			},
			{
				selector: 'edge[type = "is-a"]',
				style: {
					'line-color': c.isA,
					'target-arrow-color': c.isA,
					'target-arrow-shape': 'triangle',
					'line-style': 'solid'
				}
			},
			{
				selector: 'edge[type = "part-of"]',
				style: {
					'line-color': c.partOf,
					'target-arrow-color': c.partOf,
					'target-arrow-shape': 'triangle',
					'line-style': 'solid'
				}
			},
			{
				selector: 'edge[type = "contrasts-with"]',
				style: { 'line-color': c.contrastsWith, 'target-arrow-shape': 'none', 'line-style': 'dashed' }
			},
			{
				selector: 'edge[type = "related-to"]',
				style: { 'line-color': c.relatedTo, 'target-arrow-shape': 'none', 'line-style': 'dotted' }
			},
			{
				selector: 'edge[type = "illustrates"]',
				style: {
					'line-color': c.illustrates,
					'target-arrow-color': c.illustrates,
					'target-arrow-shape': 'triangle',
					'line-style': 'dotted',
					width: 1.5
				}
			},
			{
				selector: 'edge[type = "defines"]',
				style: { 'line-color': c.structural, 'target-arrow-shape': 'none', 'line-style': 'dashed', width: 1.5 }
			}
		];
	}

	async function initCy() {
		if (!container) return;
		const [{ default: cytoscapeFn }, { default: dagre }, { default: fcose }] = await Promise.all([
			import('cytoscape'),
			import('cytoscape-dagre'),
			import('cytoscape-fcose')
		]);
		if (!extensionsRegistered) {
			cytoscapeFn.use(dagre);
			cytoscapeFn.use(fcose);
			extensionsRegistered = true;
		}
		cy = cytoscapeFn({
			container,
			elements,
			style: buildStylesheet(),
			wheelSensitivity: 0.25
		});
		cy.on('tap', 'node', (evt) => onSelect(evt.target.id()));
		cy.on('tap', (evt) => {
			if (evt.target === cy) onSelect(null);
		});
		// Defer the first layout a frame: the container can still measure 0×0 here if the browser
		// hasn't committed a layout/paint pass yet (e.g. mounted in a background tab, or before the
		// surrounding CSS grid has settled) — `cy.fit()` against a 0-sized viewport is a silent
		// no-op that never gets retried, leaving the graph stuck at default pan/zoom. The
		// ResizeObserver below is the second line of defense if even that's too early.
		requestAnimationFrame(() => runLayout());
		ready = true;
	}

	function runLayout() {
		if (!cy) return;
		// The container can still have a stale (or zero) size cached from construction time if a
		// surrounding CSS grid/flex layout hadn't settled yet — make Cytoscape re-measure before
		// laying out, or `fit` below can compute against the wrong viewport.
		cy.resize();

		let options: cytoscape.LayoutOptions;
		if (layoutName === 'concentric') {
			const levels = bfsLevels(cy, centerIds);
			options = {
				name: 'concentric',
				concentric: (node: cytoscape.NodeSingular) => 100 - (levels.get(node.id()) ?? 5) * 10,
				levelWidth: () => 2,
				animate: false,
				padding: 40,
				minNodeSpacing: 30
			} as cytoscape.LayoutOptions;
		} else if (layoutName === 'dagre') {
			options = {
				name: 'dagre',
				rankDir: 'TB',
				nodeSep: 28,
				rankSep: 70,
				animate: false,
				padding: 30
			} as unknown as cytoscape.LayoutOptions;
		} else {
			options = {
				name: 'fcose',
				quality: 'default',
				animate: false,
				nodeSeparation: 80,
				padding: 30
			} as unknown as cytoscape.LayoutOptions;
		}

		// fcose (and, per the cytoscape docs, layouts in general) may finish asynchronously even
		// with `animate: false` — fitting synchronously right after `.run()` can capture node
		// positions mid-layout. Wait for `layoutstop` so `fit` always sees the final positions.
		const layout = cy.layout(options);
		layout.one('layoutstop', () => {
			if (!cy) return;
			cy.fit(undefined, 30);
			if (cy.width() > 0 && cy.height() > 0) hasFit = true;
		});
		layout.run();
	}

	function bfsLevels(cyInstance: cytoscape.Core, centers: string[]): Map<string, number> {
		const levels = new Map<string, number>();
		const present = centers.filter((id) => cyInstance.getElementById(id).length > 0);
		if (present.length === 0) return levels;
		for (const id of present) levels.set(id, 0);
		let frontier = present;
		let d = 0;
		while (frontier.length > 0 && d < 6) {
			d++;
			const next: string[] = [];
			for (const id of frontier) {
				const node = cyInstance.getElementById(id);
				node.connectedEdges().forEach((edge) => {
					const other = edge.source().id() === id ? edge.target().id() : edge.source().id();
					if (!levels.has(other)) {
						levels.set(other, d);
						next.push(other);
					}
				});
			}
			frontier = next;
		}
		return levels;
	}

	onMount(() => {
		initCy();

		const media = window.matchMedia('(prefers-color-scheme: dark)');
		const onThemeChange = () => cy?.style(buildStylesheet());
		media.addEventListener('change', onThemeChange);

		// Belt-and-suspenders for the 0×0-at-construction race `runLayout`'s comment describes: if
		// the container's size changes before we've ever managed a real fit, redo the whole
		// layout+fit rather than just `cy.resize()` (which alone only updates cytoscape's cached
		// viewport size, it doesn't re-fit). Once a real fit has happened, later resizes just call
		// `cy.resize()` so an ordinary window resize doesn't clobber the reader's own pan/zoom.
		const resizeObserver = new ResizeObserver(() => {
			if (!cy) return;
			if (!hasFit) runLayout();
			else cy.resize();
		});
		if (container) resizeObserver.observe(container);

		return () => {
			media.removeEventListener('change', onThemeChange);
			resizeObserver.disconnect();
			cy?.destroy();
			cy = undefined;
		};
	});

	// Re-render elements when the caller hands us a new subgraph (view/selection/filter change).
	$effect(() => {
		// touch dependencies explicitly
		const els = elements;
		const layout = layoutName;
		const centers = centerIds;
		if (!cy || !ready) return;
		cy.elements().remove();
		cy.add(els);
		void layout;
		for (const id of centers) cy.getElementById(id).addClass('map-center');
		runLayout();
	});

	// Reflect click-to-select without rebuilding the graph (independent of the permanent
	// `.map-center` badge applied above).
	$effect(() => {
		if (!cy || !ready) return;
		cy.nodes().removeClass('map-selected');
		if (selectedId) {
			cy.getElementById(selectedId).addClass('map-selected');
		}
	});

	export function fit() {
		cy?.fit(undefined, 30);
	}
</script>

<div class="map-canvas-wrap">
	<div class="map-canvas" bind:this={container} role="img" aria-label="Concept map graph canvas"></div>
	<button type="button" class="map-fit-btn" onclick={() => fit()}>Fit to screen</button>
</div>

<style>
	.map-canvas-wrap {
		position: relative;
		width: 100%;
		height: 100%;
	}

	.map-canvas {
		width: 100%;
		height: 100%;
		background: var(--color-bg-raised);
		border: 1px solid var(--color-border);
		border-radius: 0.4rem;
	}

	.map-fit-btn {
		position: absolute;
		bottom: 0.6rem;
		right: 0.6rem;
		background: var(--color-bg-raised);
		border: 1px solid var(--color-border);
		border-radius: 0.3rem;
		padding: 0.35rem 0.7rem;
		font-size: 0.8rem;
		cursor: pointer;
		color: var(--color-text);
	}

	.map-fit-btn:hover {
		border-color: var(--color-accent);
	}
</style>
