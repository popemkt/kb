/**
 * The rows the read view (`NodeReadView`) lays out under a node: its
 * descendants in reading order, to a depth and a row cap, so a large graph
 * reads as a page, not a dump.
 */
import { rowText, shownNodeId, type NodeMap, type SchemaIndex } from "@kb/ui-sdk";

/** How far below the root the read view lays descendants out; a deeper row opens by its parent. */
export const READ_DEPTH = 3;

/** At most this many rows below the top level, so a large graph reads as a page, not a dump. */
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

/** What the read view lays out: its rows, and how many it left out at its cap. */
interface ReadRows {
  readonly rows: ReadRow[];
  /** Rows within the depth that the cap dropped, counted for a trailing "N more" marker. */
  readonly more: number;
}

/**
 * The rows under `rootId` in `nodes` (a reference read through `schema`, the
 * whole graph, as the outline reads it), in reading order: its descendants down
 * to `depth` levels, each row's children left out past that depth counted on
 * it. Collapse is the editor's, so the read view ignores it.
 *
 * The cap `max` is spent shallowest level first, so the nodes at the top
 * always appear and what a large graph drops is its deepest rows: the top
 * level is never capped, and `more` counts the rows the cap dropped.
 */
export function readRows(
  nodes: NodeMap,
  schema: SchemaIndex,
  rootId: string,
  depth = READ_DEPTH,
  max = READ_ROWS,
): ReadRows {
  const kept = new Set<string>();
  const childrenOf = (id: string): string[] =>
    (nodes.get(id)?.children ?? []).filter((child) => nodes.has(child));
  let total = 0;
  const count = (id: string, level: number): void => {
    for (const child of childrenOf(id)) {
      total += 1;
      if (level < depth) count(child, level + 1);
    }
  };
  count(rootId, 1);
  // Breadth first: each level takes what the cap leaves, in reading order, under parents kept.
  let frontier = [rootId];
  for (let level = 1; level <= depth && frontier.length > 0; level++) {
    const next: string[] = [];
    for (const parent of frontier) {
      for (const child of childrenOf(parent)) {
        if (level > 1 && kept.size >= max) continue;
        kept.add(child);
        next.push(child);
      }
    }
    frontier = next;
  }
  const rows: ReadRow[] = [];
  const walk = (id: string, level: number): void => {
    for (const child of childrenOf(id)) {
      if (!kept.has(child)) continue;
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
  return { rows, more: total - kept.size };
}
