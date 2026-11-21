import type { NodeMap } from "./types";
import { WORKSPACE_ROOT_ID } from "./types";
import { MAIN_PANE } from "./pane";

/**
 * The outline host the main pane's outline keys its rows under: the
 * canonical outline instance (`tree/<path>`).
 */
export const MAIN_OUTLINE_HOST = "tree";

/**
 * The outline host of a pane: every outline drawn in it keys its rows under
 * this, so the same node open in two panes is two rows, edited one at a time.
 * The main pane's is the canonical {@link MAIN_OUTLINE_HOST}.
 */
export function outlineHostOfPane(pane: string): string {
  return pane === MAIN_PANE ? MAIN_OUTLINE_HOST : `pane:${pane}`;
}

/** The host an instance key is keyed under: everything before its first separator. */
export function hostOfInstance(instanceKey: string): string {
  const cut = instanceKey.indexOf("/");
  return cut < 0 ? instanceKey : instanceKey.slice(0, cut);
}

/** Nest a child render under a parent instance key. */
export function childInstanceKey(parentKey: string, nodeId: string): string {
  return `${parentKey}/${nodeId}`;
}

/**
 * The place a row instance stands at, which its open or closed choice is
 * kept under (`isRowOpen`): where in the graph it is drawn, whatever pane
 * draws it. A row of an outline's walk of the tree stands at its path, under
 * the canonical host whichever host walks it; a projected instance (a query's
 * result, a reference opened in place, and every row under one) at its own
 * key, which already names its source rather than its host. So a node drawn
 * at two places keeps two choices, and one place open in two panes keeps one.
 */
export function placeOfInstance(instanceKey: string): string {
  if (isProjectedInstance(instanceKey)) return instanceKey;
  const cut = instanceKey.indexOf("/");
  return cut < 0 ? instanceKey : `${MAIN_OUTLINE_HOST}${instanceKey.slice(cut)}`;
}

/** The node a row instance draws: the last segment of its key. */
export function nodeOfInstance(instanceKey: string): string {
  return instanceKey.slice(instanceKey.lastIndexOf("/") + 1);
}

/**
 * What a row instance is drawn under, so that `childInstanceKey` of it and a
 * sibling is where that sibling is drawn beside the row: its parent row's
 * instance, or its outline host for a top-level row. Null where the row's
 * place is computed, not a child edge: a projected row (`projectedRowKey`),
 * or the node a canvas card or a page title shows.
 */
export function parentInstanceKey(instanceKey: string): string | null {
  if (isProjectedRow(instanceKey)) return null;
  const cut = instanceKey.lastIndexOf("/");
  if (cut < 0) return null;
  const parent = instanceKey.slice(0, cut);
  return isProjectedInstance(parent) && !parent.includes("/") ? null : parent;
}

/**
 * A node's instance in the outline host `host` (parent path + node id): the
 * key its row takes where that outline draws it from the tree. Used when
 * mutations or the keyboard activate a row without naming its instance.
 */
export function outlineInstanceKey(
  nodeId: string,
  nodes: NodeMap,
  host: string = MAIN_OUTLINE_HOST,
): string {
  const chain: string[] = [];
  let cur: string | null = nodeId;
  const seen = new Set<string>();
  while (cur !== null && cur !== WORKSPACE_ROOT_ID) {
    if (seen.has(cur)) break;
    seen.add(cur);
    chain.unshift(cur);
    cur = nodes.get(cur)?.parentId ?? null;
  }
  return `${host}/${chain.join("/")}`;
}

/**
 * Every instance drawn somewhere other than an outline's walk of the tree
 * carries this prefix — a query's projected rows, a node shown on a canvas —
 * and so does everything nested under one (`childInstanceKey` appends to it).
 */
const PROJECTION_PREFIX = "ref:";
const PROJECTED_ROW_PREFIX = `${PROJECTION_PREFIX}row:`;
const CANVAS_PREFIX = `${PROJECTION_PREFIX}canvas:`;
const TITLE_PREFIX = `${PROJECTION_PREFIX}title:`;

/**
 * A page's title, edited where the page head draws it: a projected instance,
 * since the outline's walk of the tree does not draw the page's own node as a
 * row, so it is activated (and is the page's edit, `editing()`) as a row is.
 * It names the outline host whose head draws it, as a row's key does: two
 * panes showing one node have two titles, and selecting one selects that
 * pane's.
 */
export function pageTitleInstanceKey(nodeId: string, host: string): string {
  return `${TITLE_PREFIX}${host}:${nodeId}`;
}

/**
 * A node shown by canvas card `cardId`, as the projection `projection` (2D
 * or 3D) draws it: a projected instance, so the outline's walk of the tree
 * does not decide whether it is on screen — the card mounting its text does.
 * Each projection's is its own, so the one showing edits it alone.
 */
export function canvasInstanceKey(projection: string, cardId: string, nodeId: string): string {
  return `${CANVAS_PREFIX}${projection}:${cardId}/${nodeId}`;
}

/**
 * A projected row: node `nodeId` drawn under the row of `sourceId` because
 * that row computes it (DESIGN-UI.md → Projected rows), not because it is
 * a child. It names its source, not its outline host, so one source open in
 * two panes draws rows under the same keys, and the keyboard walks them in
 * the main pane's outline. GAP [[01M411FPC839XBJJ873V1VYYYD]]
 */
export function projectedRowKey(sourceId: string, nodeId: string): string {
  return `${PROJECTED_ROW_PREFIX}${sourceId}/${nodeId}`;
}

/**
 * Whether instance `instanceKey` of node `nodeId` may be drawn by outline
 * host `host`: a row keyed under that host, or the page's title there. A
 * title or a row keyed under another host is another pane's. A query's
 * projected row or a canvas card names its source, not its host, so its key
 * cannot rule it out.
 */
export function mayBeInHost(instanceKey: string, nodeId: string, host: string): boolean {
  if (instanceKey.startsWith(TITLE_PREFIX))
    return instanceKey === pageTitleInstanceKey(nodeId, host);
  return isProjectedInstance(instanceKey) || hostOfInstance(instanceKey) === host;
}

/**
 * The instance is projected: drawn somewhere other than an outline's walk of
 * the tree — inside a query's projected rows (a result row or one of its
 * descendants), or on a canvas. Its visibility is decided by the component
 * that mounts it, not by the outline walk.
 */
export function isProjectedInstance(instanceKey: string): boolean {
  return instanceKey.startsWith(PROJECTION_PREFIX);
}

/**
 * The instance IS a projected row: its place under its source is computed,
 * not a child edge, so there is no structural edge for Tab, Enter or a move
 * to operate on. Its descendants are ordinary child edges of the row and
 * are not projected rows themselves.
 *
 * Read from the key because the key is the row's identity: whatever renders
 * the row, the answer cannot disagree with where the row actually is.
 */
export function isProjectedRow(instanceKey: string): boolean {
  return projectedRowOf(instanceKey) !== null;
}

/** The source and node of projected row `instanceKey` (`projectedRowKey`), or null when it is not one. */
export function projectedRowOf(
  instanceKey: string,
): { readonly sourceId: string; readonly nodeId: string } | null {
  if (!instanceKey.startsWith(PROJECTED_ROW_PREFIX)) return null;
  // `ref:row:<sourceId>/<nodeId>` — one separator; a descendant adds more.
  const [sourceId, nodeId, ...below] = instanceKey.slice(PROJECTED_ROW_PREFIX.length).split("/");
  return sourceId === undefined || nodeId === undefined || below.length > 0
    ? null
    : { sourceId, nodeId };
}

/**
 * The node ids of the rows an instance is drawn under, outermost first — the
 * source of a projected row, then every row on the path down to (not
 * including) the instance itself.
 */
export function instanceAncestorIds(instanceKey: string): string[] {
  const path = instanceKey.startsWith(PROJECTED_ROW_PREFIX)
    ? instanceKey.slice(PROJECTED_ROW_PREFIX.length)
    : instanceKey.slice(instanceKey.indexOf("/") + 1);
  return path.split("/").slice(0, -1);
}
