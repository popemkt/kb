import type { WireNode } from "@kb/contracts";
import { ranksFor, siblingSlots } from "@kb/model";
import { fixtureGraph } from "@/api/fixture-graph";

/**
 * The fixture graph with every row ranked, as a store ranks it: a row placed
 * or restored takes a rank, and among unranked siblings it would sort first.
 */
export function rankedFixture(): WireNode[] {
  const nodes = structuredClone(fixtureGraph.nodes);
  const ranks = ranksFor(siblingSlots(nodes, null).map((n) => n.id));
  for (const parent of nodes)
    for (const [id, rank] of ranksFor(parent.children)) ranks.set(id, rank);
  return nodes.map((n) => ({ ...n, order: ranks.get(n.id) ?? n.order }));
}
