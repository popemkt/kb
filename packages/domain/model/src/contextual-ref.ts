/**
 * Contextual references: a node shown at a second place (DESIGN-UI.md →
 * Contextual references). A contextual reference is an ordinary node
 * carrying its target on the `sys.f.ref.target` ref field; the field is the
 * whole declaration, so stripping it leaves a plain node. This module is the
 * one reader of that field, isomorphic, so the page's rows and the domain's
 * readers (an export's projection) ask the same question the same way.
 */
import { SYSTEM_IDS, type NodeId } from "./model.ts";
import type { NodeLike } from "./node-like.ts";

/**
 * The node this reference points at, or null when it is not a reference.
 *
 * One read of one carrier. "Is it named `ref`?" was never on the table: a
 * user tag called `ref` must not turn its rows into references, and it
 * cannot, because nothing reads a tag name here at all.
 */
export function contextualTargetOf(node: Pick<NodeLike, "props"> | undefined): NodeId | null {
  const value = (node?.props[SYSTEM_IDS.refTargetField] ?? []).find(
    (v) => v.t === "ref" && typeof v.v === "string" && v.v !== "",
  );
  return value ? String(value.v) : null;
}

export function isContextualRef(node: Pick<NodeLike, "props"> | undefined): boolean {
  return contextualTargetOf(node) !== null;
}

/**
 * The node a row shows: the target of a contextual reference, and the row
 * itself otherwise, a dangling reference included, which has nothing else
 * to show. `nodeOf` is the whole graph, so a reference to a node outside a
 * page's scope still shows it.
 */
export function shownNodeOf<N extends Pick<NodeLike, "props">>(
  row: N,
  nodeOf: (id: NodeId) => N | undefined,
): N {
  const target = contextualTargetOf(row);
  return target === null ? row : (nodeOf(target) ?? row);
}

/** A row met by {@link shownWalk}: the row, the node it shows, and the rows under it. */
export interface ShownRow<N> {
  readonly row: N;
  /** Its target for a contextual reference whose target is there; the row itself otherwise. */
  readonly shown: N;
  readonly children: readonly ShownRow<N>[];
}

/**
 * The rows `rowIds` name and every row under them, as a reader of what rows
 * show meets them (DESIGN-UI.md → Outline editor, "What rows hold, read and
 * copied"): each row reads as the node it shows, and a contextual reference
 * is a leaf, its target's children not followed. A row is met once; an id
 * `nodeOf` does not know is left out. Count words counts these rows, and an
 * export's projection writes them.
 */
export function shownWalk<N extends Pick<NodeLike, "props" | "children">>(
  rowIds: readonly NodeId[],
  nodeOf: (id: NodeId) => N | undefined,
): ShownRow<N>[] {
  const met = new Set<NodeId>();
  const walk = (ids: readonly NodeId[]): ShownRow<N>[] =>
    ids.flatMap((id) => {
      const row = nodeOf(id);
      if (row === undefined || met.has(id)) return [];
      met.add(id);
      const leaf = isContextualRef(row);
      return [{ row, shown: shownNodeOf(row, nodeOf), children: leaf ? [] : walk(row.children) }];
    });
  return walk(rowIds);
}
