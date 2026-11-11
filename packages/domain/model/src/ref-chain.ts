/**
 * Where a ref field leads: the one walk over a field whose values point at
 * nodes of the same kind as the one holding them — a tag's `sys.f.extends`,
 * an ontology's `sys.f.onto.extends`.
 *
 * A chain is breadth first in declared order, each node once, so a diamond
 * reaches a shared node once and a cycle ends where it closes: nothing
 * graph-shaped throws. Whether a new value would close a cycle is asked of
 * the same walk ({@link closesCycle}), so the reader and the pre-check can
 * never disagree about where a field leads.
 */
import type { NodeId } from "./model.ts";
import { refValuesOf, type NodeLike } from "./node-like.ts";

/** How a reader finds a node: the graph it is asked over. */
export type NodeLookup = (id: NodeId) => Pick<NodeLike, "props"> | undefined;

/** `start`, then every node its `field` values reach, breadth first in declared order, each once. */
export function refChain(nodeOf: NodeLookup, field: NodeId, start: NodeId): readonly NodeId[] {
  const chain = new Set<NodeId>();
  const queue: NodeId[] = [start];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (chain.has(next)) continue;
    chain.add(next);
    queue.push(...refValuesOf(nodeOf(next), field));
  }
  return [...chain];
}

/**
 * Whether `holder` taking `candidate` as a `field` value would close a cycle:
 * whether `candidate`'s chain reaches `holder`, itself included.
 */
export function closesCycle(
  nodeOf: NodeLookup,
  field: NodeId,
  holder: NodeId,
  candidate: NodeId,
): boolean {
  return refChain(nodeOf, field, candidate).includes(holder);
}
