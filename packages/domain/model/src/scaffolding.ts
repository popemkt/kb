/**
 * The store's scaffolding: the nodes that are its machinery rather than its
 * content, which every content surface leaves out. Those surfaces are the
 * home outline, the graph, a day's touched nodes, a canvas's node picker
 * and unlinked mentions. A `sys.*` node is scaffolding, and so is a node of
 * one of `SCAFFOLDING_KINDS`.
 */
import { isSysPrefixed, SYSTEM_IDS, type NodeId, type PropValue } from "./model.ts";
import { typeRefsOf } from "./node-like.ts";

/** The kinds whose nodes are scaffolding: the schema (tags and fields) and commands. */
const SCAFFOLDING_KINDS: ReadonlySet<NodeId> = new Set([
  SYSTEM_IDS.tag,
  SYSTEM_IDS.field,
  SYSTEM_IDS.command,
]);

/** Whether `node` is scaffolding, which content surfaces leave out. */
export function isScaffolding(node: {
  readonly id: NodeId;
  readonly props: Readonly<Record<string, readonly PropValue[]>>;
}): boolean {
  return isSysPrefixed(node.id) || typeRefsOf(node).some((kind) => SCAFFOLDING_KINDS.has(kind));
}
