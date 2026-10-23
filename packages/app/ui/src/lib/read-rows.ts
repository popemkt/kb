/**
 * The rows the read view (`NodeReadView`) lays out under a node: its
 * descendants in reading order, to a depth and a row cap, so a large graph
 * reads as a page, not a dump.
 */
import { rowText, shownNodeId, type NodeMap, type SchemaIndex } from "@kb/ui-sdk";

/** How far below the root the read view lays descendants out; a deeper row opens by its parent. */
export const READ_DEPTH = 3;

/** At most this many rows, so a large graph reads as a page, not a dump. */
const READ_ROWS = 400;

/** One row of the read view: a descendant of the root, at its depth below it. */
interface ReadRow {
  readonly id: string;
  /** What the row reads as: its text, or a reference's target's (`rowText`). */
  readonly text: string;
  /** The node the row opens: itself, or the node a reference points at. */
  readonly opens: string;
  readonly depth: number;
  /** Its children the view leaves out, past {@link READ_DEPTH}. */
  readonly hidden: number;
}

/**
 * The rows under `rootId` in `nodes` (a reference read through `schema`, the
 * whole graph, as the outline reads it), in reading order: its descendants down
 * to `depth` levels, at most `max` of them, each row's children left out past
 * that depth counted on it. Collapse is the editor's, so the read view
 * ignores it.
 */
export function readRows(
  nodes: NodeMap,
  schema: SchemaIndex,
  rootId: string,
  depth = READ_DEPTH,
  max = READ_ROWS,
): ReadRow[] {
  const rows: ReadRow[] = [];
  const walk = (id: string, level: number): void => {
    for (const child of nodes.get(id)?.children ?? []) {
      if (rows.length >= max) return;
      const node = nodes.get(child);
      if (node === undefined) continue;
      const deeper = level < depth;
      rows.push({
        id: child,
        text: rowText(node, schema),
        opens: shownNodeId(node),
        depth: level,
        hidden: deeper ? 0 : node.children.length,
      });
      if (deeper) walk(child, level + 1);
    }
  };
  walk(rootId, 1);
  return rows;
}
