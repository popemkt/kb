/**
 * Zooming from a row, the steps every zoom key runs: in, onto the page of
 * the node the row shows, as its bullet opens one; and out, to the page
 * above the one its outline shows, as its crumbs open one.
 */
import { browserHost, shownNodeId, WORKSPACE_ROOT_ID } from "@kb/ui-sdk";
import { crumbsTo } from "./crumbs";
import { outlineNodes } from "./outline.store";
import { openFromRow, outlineHostOf, outlineHostOfInstance } from "./outline-hosts";

/** Open the page of the node the row shows — a reference's original — as its outline opens one. */
export function zoomIntoRow(nodeId: string, instanceKey: string): void {
  const node = outlineNodes().get(nodeId);
  openFromRow(instanceKey, node ? shownNodeId(node) : nodeId);
}

/**
 * Zoom out of the page the row's outline shows, to the one above it: the
 * crumb before its last (`crumbsTo`), or home. At home there is nothing
 * above, so nothing moves. A pane rooted at a node moves its pane, as its
 * crumbs do; the zoomed outline zooms.
 */
export function zoomOut(instanceKey: string): void {
  const host = outlineHostOf(outlineHostOfInstance(instanceKey));
  const graph = browserHost().graph.state();
  const rooted = host?.root ?? null;
  const root = rooted ?? graph.rootNodeId;
  const home = rooted === null ? graph.homeRootId : WORKSPACE_ROOT_ID;
  if (root === home) return;
  const crumbs = crumbsTo(root, home, outlineNodes(), browserHost().schema());
  const above = crumbs.at(-2)?.id ?? home;
  (host?.open ?? browserHost().zoomTo)(above);
}
