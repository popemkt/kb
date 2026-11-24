/**
 * The store's scaffolding: the nodes that are its machinery rather than its
 * content, which every content surface leaves out (DESIGN-UI.md → Outline
 * editor, "The home outline"). Those surfaces are the home outline, the
 * graph, a day's touched nodes, a canvas's node picker and unlinked
 * mentions. A `sys.*` node is scaffolding, and so is a node of one of
 * `SCAFFOLDING_KINDS`.
 *
 * A tag is content, a node like any other: it shows where any node shows,
 * with its own order, children and page.
 */
import { isSysPrefixed, SYSTEM_IDS, type NodeId, type PropValue } from "./model.ts";
import { typeRefsOf } from "./node-like.ts";

/**
 * The kinds whose nodes are scaffolding. A field is one until its owner
 * decides otherwise: taking `SYSTEM_IDS.field` out of this set shows every
 * field node wherever a node shows.
 */
const SCAFFOLDING_KINDS: ReadonlySet<NodeId> = new Set([SYSTEM_IDS.field, SYSTEM_IDS.command]);

/** Whether `node` is scaffolding, which content surfaces leave out. */
export function isScaffolding(node: {
  readonly id: NodeId;
  readonly props: Readonly<Record<string, readonly PropValue[]>>;
}): boolean {
  return isSysPrefixed(node.id) || typeRefsOf(node).some((kind) => SCAFFOLDING_KINDS.has(kind));
}
