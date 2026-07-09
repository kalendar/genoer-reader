<script lang="ts">
	import type { GraphIndex, ConceptNode } from '$lib/data/graph';
	import { conceptsBySection, prerequisiteAncestors, isEarlierSection } from '$lib/data/graph';
	import { bookQuerySuffix } from '$lib/utils/book-link';
	import { base } from '$app/paths';

	let bookSuffix = $derived(bookQuerySuffix());

	let {
		graph,
		sectionId,
		visitedSections = new Set<string>()
	}: {
		graph: GraphIndex;
		/** Module id of the section currently open (SPEC.md §4 "Before you read"). */
		sectionId: string;
		/** Section module ids the reader has already visited this session — dims their entries
		 * rather than hiding them (SPEC.md §4: "optionally dimmed"). */
		visitedSections?: Set<string>;
	} = $props();

	const OPEN_BY_DEFAULT_MAX = 4;

	interface PrereqEntry {
		concept: ConceptNode;
		sectionModule: string;
		sectionTitle: string;
		sectionNumber: string | null;
	}

	let prerequisites = $derived.by((): PrereqEntry[] => {
		const definedHere = conceptsBySection(graph, sectionId);
		const byId = new Map<string, PrereqEntry>();
		for (const concept of definedHere) {
			for (const ancestor of prerequisiteAncestors(graph, concept.id)) {
				if (byId.has(ancestor.id)) continue;
				if (!isEarlierSection(graph, ancestor.defined_in, sectionId)) continue;
				const section = graph.sectionByModule.get(ancestor.defined_in);
				byId.set(ancestor.id, {
					concept: ancestor,
					sectionModule: ancestor.defined_in,
					sectionTitle: section?.title ?? ancestor.defined_in,
					sectionNumber: section?.number ?? null
				});
			}
		}
		return [...byId.values()].sort(
			(a, b) =>
				(graph.sectionOrder.get(a.sectionModule) ?? 0) - (graph.sectionOrder.get(b.sectionModule) ?? 0) ||
				a.concept.term.localeCompare(b.concept.term)
		);
	});
</script>

{#if prerequisites.length > 0}
	<details class="prereq-panel" open={prerequisites.length <= OPEN_BY_DEFAULT_MAX}>
		<summary>
			Before you read
			<span class="prereq-count">{prerequisites.length} concept{prerequisites.length === 1 ? '' : 's'} to know</span>
		</summary>
		<p class="prereq-intro">
			This section builds on ideas introduced earlier in the book:
		</p>
		<ul class="prereq-list">
			{#each prerequisites as entry (entry.concept.id)}
				<li class="prereq-item" class:prereq-visited={visitedSections.has(entry.sectionModule)}>
					<a href="{base}/read/{entry.sectionModule}{bookSuffix}" class="prereq-term">{entry.concept.term}</a>
					<span class="prereq-definition">{entry.concept.definition}</span>
					<span class="prereq-source">
						{entry.sectionNumber ? `§${entry.sectionNumber} ` : ''}{entry.sectionTitle}
					</span>
				</li>
			{/each}
		</ul>
	</details>
{/if}
