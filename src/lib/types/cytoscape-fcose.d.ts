/**
 * cytoscape-fcose ships no type declarations and there's no @types package for it (unlike
 * cytoscape-dagre, which bundles its own). Minimal shim covering the surface this app uses:
 * `cytoscape.use(fcose)` and the `{ name: 'fcose', ... }` layout options passed to `cy.layout()`.
 */
declare module 'cytoscape-fcose' {
	import type cytoscape from 'cytoscape';

	const fcose: cytoscape.Ext;
	export default fcose;
}
