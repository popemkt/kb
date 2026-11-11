/**
 * Where an add puts its node (DESIGN.md → Provider roles, the capture
 * target): the place its input names, or the capture target's for none,
 * and the graph the add is planned in with what that place needs made.
 */
import { Effect } from "effect";
import { CaptureTarget, type CapturePlan } from "@kb/contracts";
import { IndexedNodes, present, type DomainError, type KbNode, type NodeId } from "@kb/model";

/**
 * Where `node.add`'s input puts the node, in the store that holds `nodes`:
 * under the parent it names, at the top level for null, and where the
 * capture target says for none, with what the target makes there first.
 */
export const placeOf = Effect.fn("node.add.place")(function* (
  parent: NodeId | null | undefined,
  nodes: readonly KbNode[],
): Effect.fn.Return<CapturePlan, DomainError, CaptureTarget> {
  if (parent !== undefined) return { parent, upserts: [] };
  const target = yield* CaptureTarget;
  return yield* target(nodes);
});

/**
 * The graph over `nodes` an add is planned in, with what its place needs
 * `made` already put, so the add sees it and lands with it. `upserts` reads
 * back what was made and whatever the add then `wrote`.
 */
export function placedGraph(
  nodes: readonly KbNode[],
  made: readonly KbNode[],
): { graph: IndexedNodes; upserts: (wrote: Iterable<NodeId>) => KbNode[] } {
  const graph = IndexedNodes.of(nodes);
  for (const node of made) graph.put(node);
  const upserts = (wrote: Iterable<NodeId>): KbNode[] =>
    [...new Set([...made.map((node) => node.id), ...wrote])].map((id) =>
      present(graph.get(id), "a written node is in the graph"),
    );
  return { graph, upserts };
}
