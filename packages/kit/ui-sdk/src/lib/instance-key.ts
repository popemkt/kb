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

/**
 * The host an instance key is keyed under: a projected row's names it after
 * its prefix (`projectedRowKey`), every other key before its first separator.
 */
export function hostOfInstance(instanceKey: string): string {
  if (instanceKey.startsWith(PROJECTED_ROW_PREFIX)) {
    const rest = instanceKey.slice(PROJECTED_ROW_PREFIX.length);
    return rest.slice(0, Math.max(0, rest.indexOf(HOST_MARK)));
  }
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
 * the canonical host whichever host walks it; a projected row (a query's
 * result, a reference opened in place, and every row under one) stands under
 * the canonical host too, and any other projected instance at its own key.
 * So a node drawn at two places keeps two choices, and one place open in two
 * panes keeps one.
 */
export function placeOfInstance(instanceKey: string): string {
  if (instanceKey.startsWith(PROJECTED_ROW_PREFIX)) {
    const rest = instanceKey.slice(PROJECTED_ROW_PREFIX.length);
    const mark = rest.indexOf(HOST_MARK);
    return mark < 0
      ? instanceKey
      : `${PROJECTED_ROW_PREFIX}${MAIN_OUTLINE_HOST}${rest.slice(mark)}`;
  }
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
/** Between a projected row's outline host and its source (`projectedRowKey`). */
const HOST_MARK = "@";

/**
 * A page's title, edited where the page head draws it: a projected instance,
 * since the outline's walk of the tree does not draw the page's own node as a
 * row, so it is activated (and is the page's edit, `editing()`) as a row is.
 */
export function pageTitleInstanceKey(nodeId: string): string {
  return `${TITLE_PREFIX}${nodeId}`;
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
 * a child, in the outline of host `host`. It names its host as every row
 * does, so one source open in two panes draws two rows, and the keyboard
 * walks each in the outline it is drawn in (`hostOfInstance`).
 */
export function projectedRowKey(host: string, sourceId: string, nodeId: string): string {
  return `${PROJECTED_ROW_PREFIX}${host}${HOST_MARK}${sourceId}/${nodeId}`;
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

/** The host, source and node of projected row `instanceKey` (`projectedRowKey`), or null when it is not one. */
export function projectedRowOf(
  instanceKey: string,
): { readonly host: string; readonly sourceId: string; readonly nodeId: string } | null {
  if (!instanceKey.startsWith(PROJECTED_ROW_PREFIX)) return null;
  // `ref:row:<host>@<sourceId>/<nodeId>` — one separator; a descendant adds more.
  const [head, nodeId, ...below] = instanceKey.slice(PROJECTED_ROW_PREFIX.length).split("/");
  const mark = head?.indexOf(HOST_MARK) ?? -1;
  if (head === undefined || mark < 0 || nodeId === undefined || below.length > 0) return null;
  return { host: head.slice(0, mark), sourceId: head.slice(mark + 1), nodeId };
}

/**
 * The node ids of the rows an instance is drawn under, outermost first — the
 * source of a projected row, then every row on the path down to (not
 * including) the instance itself.
 */
export function instanceAncestorIds(instanceKey: string): string[] {
  const path = instanceKey.startsWith(PROJECTED_ROW_PREFIX)
    ? instanceKey.slice(instanceKey.indexOf(HOST_MARK) + 1)
    : instanceKey.slice(instanceKey.indexOf("/") + 1);
  return path.split("/").slice(0, -1);
}
