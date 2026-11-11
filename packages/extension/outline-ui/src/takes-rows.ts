/**
 * Whether a page takes rows typed into it: a node shown as a list, not in a
 * projected view (a table, a board), and not a query, whose rows are its
 * results. Such a page offers the strip that adds a row at its end, and
 * Enter from its title opens a first row.
 */
import { isQueryNode, type NodeLike } from "@kb/model";
import { projectsRows, type FrameViewKey } from "@kb/views";

export function takesRows(node: NodeLike, view: FrameViewKey | null): boolean {
  return !projectsRows(view) && !isQueryNode(node);
}
