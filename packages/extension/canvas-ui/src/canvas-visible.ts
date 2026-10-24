import {
  edgeRoute,
  pinnedItems,
  routeMidpoint,
  routePoints,
  type CanvasDoc,
  type CanvasNode,
  type CanvasThread,
  type EdgeRoute,
} from "@kb/canvas";
import type { ScreenRegion } from "@kb/ui-sdk";
import type { PressChrome } from "./canvas-projections";
import {
  projectPoint,
  screenBounds,
  type CanvasPoint,
  type CanvasScreenPoint,
  type CanvasView,
  type ScreenRect,
  type ViewSize,
} from "./canvas-camera";

/**
 * Where `view` draws each item on a stage of `size`, in document order: the
 * screen bounds of its box (`screenBounds`), in whichever projection holds
 * the camera. An item none of which is in front of the eye has none.
 */
export function itemScreenRects(
  items: readonly CanvasNode[],
  view: CanvasView,
  size: ViewSize,
): Map<string, ScreenRect> {
  const rects = new Map<string, ScreenRect>();
  if (view.zoom <= 0 || size.width <= 0 || size.height <= 0) return rects;
  for (const item of items) {
    const drawn = screenBounds(view, size, item);
    if (drawn !== null) rects.set(item.id, drawn);
  }
  return rects;
}

/** Where a comment thread's pin stands on the stage: the tip it points from. */
export interface ThreadPin {
  readonly thread: CanvasThread;
  /** The item it stands on; null for a thread pinned at a point. */
  readonly item: string | null;
  readonly at: CanvasPoint;
}

/**
 * Where `view` pins each of `threads` on a stage of `size`: at the top right
 * of each item the thread is pinned on (`pinnedItems`), as that item is
 * drawn (its anchor, `itemScreenRects`), or where its point on the floor is
 * drawn. None where nothing it is pinned on is in front of the eye, and
 * none for a thread whose pin is lost (the lint's `orphan-comment`).
 */
export function threadPins(
  threads: readonly CanvasThread[],
  doc: CanvasDoc,
  view: CanvasView,
  size: ViewSize,
): ThreadPin[] {
  // Only the items threads are pinned on are placed: a canvas with no threads places none.
  const drawn = (item: CanvasNode) => itemScreenRects([item], view, size).get(item.id);
  return threads.flatMap((thread) => {
    const { anchor } = thread;
    if (anchor === null) return [];
    const tips =
      "at" in anchor
        ? [{ item: null, at: projectPoint(view, size, { ...anchor.at, z: 0 }) }]
        : pinnedItems(anchor, doc).map((item) => {
            const rect = drawn(item);
            return {
              item: item.id,
              at: rect === undefined ? null : { x: rect.right, y: rect.top },
            };
          });
    return tips.flatMap(({ item, at }) => (at === null ? [] : [{ thread, item, at }]));
  });
}

/**
 * The ids of the items any part of which `view` draws inside a stage of
 * `size`, in document order: what the screen state reports as visible.
 */
export function visibleItemIds(
  items: readonly CanvasNode[],
  view: CanvasView,
  size: ViewSize,
): string[] {
  return [...itemScreenRects(items, view, size)]
    .filter(
      ([, drawn]) =>
        drawn.left < size.width && drawn.right > 0 && drawn.top < size.height && drawn.bottom > 0,
    )
    .map(([id]) => id);
}

/**
 * How wide an edge takes gestures on screen, CSS pixels: wider than any
 * edge is drawn, so nothing drawn over the canvas reaches its line.
 */
const EDGE_REACH = 16;

/**
 * Where `view` draws each edge of `doc` whose two ends are on it, as a line
 * on screen: its route (`edgeRoute`, `routePoints`, the path both
 * projections draw), each point projected through the camera, those behind
 * the eye left out.
 */
export function edgeScreenLines(
  doc: CanvasDoc,
  view: CanvasView,
  size: ViewSize,
): { readonly id: string; readonly points: CanvasScreenPoint[] }[] {
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  return doc.edges.flatMap((edge) => {
    const from = byId.get(edge.fromNode);
    const to = byId.get(edge.toNode);
    if (from === undefined || to === undefined) return [];
    const points = routePoints(edgeRoute(from, to, edge))
      .map((point) => projectPoint(view, size, point))
      .filter((point) => point !== null);
    return points.length < 2 ? [] : [{ id: edge.id, points }];
  });
}

/** `rect` grown by `by` on every side. */
const grown = (rect: ScreenRect, by: number): ScreenRect => ({
  left: rect.left - by,
  top: rect.top - by,
  right: rect.right + by,
  bottom: rect.bottom + by,
});

/** What a press reaches beyond the document's items and edges: the projection's chrome round them, which items are selected, and the projection's own handles. */
export interface PressReach {
  readonly chrome: PressChrome;
  readonly selected: ReadonlySet<string>;
  readonly own: readonly ScreenRect[];
}

/**
 * Where a press on a stage of `size` reaches something under `view`: each
 * item's screen rectangle grown by the chrome the projection draws round it
 * (`PressChrome.item`, scaled by the zoom; a selected item's by its
 * handles), each edge's route `EDGE_REACH` wide, each edge's label about its
 * route's middle, and `own`, what the projection's own handles reach (the 3D
 * gizmo). What a script's drawing is masked off (DESIGN-UI.md → Scripts).
 */
export function pressRegions(
  doc: CanvasDoc,
  view: CanvasView,
  size: ViewSize,
  { chrome, selected, own }: PressReach,
): ScreenRegion[] {
  const items = [...itemScreenRects(doc.nodes, view, size)].map(([id, rect]) => ({
    box: grown(rect, chrome.item(selected.has(id)) * view.zoom),
  }));
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  const labels = doc.edges.flatMap((edge) => {
    const from = byId.get(edge.fromNode);
    const to = byId.get(edge.toNode);
    const reach = chrome.label(edge.label ?? "");
    if (from === undefined || to === undefined || reach === null) return [];
    const at = projectPoint(view, size, { ...routeMidpoint(edgeRoute(from, to, edge)), z: 0 });
    if (at === null) return [];
    const [w, h] = [reach.halfWidth * view.zoom, reach.halfHeight * view.zoom];
    return [{ box: { left: at.x - w, top: at.y - h, right: at.x + w, bottom: at.y + h } }];
  });
  return [
    ...items,
    ...edgeScreenLines(doc, view, size).map(({ points }) => ({
      line: points,
      width: EDGE_REACH,
    })),
    ...labels,
    ...own.map((box) => ({ box })),
  ];
}

/** A stretch of the floor, canvas units: where the 2D stage draws what it draws. */
export interface FloorWindow {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * How far past its box an item may paint, canvas units: its lift's shadow,
 * its outline's stroke, its ports and handles.
 */
const ITEM_OVERHANG = 48;

/**
 * The floor the 2D stage draws for the top view `view` on a stage of
 * `size`: what it shows, grown by a cell each way, where a cell is half of
 * what the stage would show at the zoom rounded down to a half octave, and
 * snapped to those cells. So a pan or a zoom draws nothing new until the
 * view crosses a cell, and an item is drawn before it comes into sight.
 * Null when the stage has no size yet: then everything is drawn.
 */
export function floorWindow(view: CanvasView, size: ViewSize): FloorWindow | null {
  if (view.zoom <= 0 || size.width <= 0 || size.height <= 0) return null;
  const coarse = 2 ** (Math.floor(Math.log2(view.zoom) * 2) / 2);
  const cell = { x: size.width / coarse / 2, y: size.height / coarse / 2 };
  const half = { x: size.width / view.zoom / 2, y: size.height / view.zoom / 2 };
  return {
    left: (Math.floor((view.x - half.x) / cell.x) - 1) * cell.x,
    top: (Math.floor((view.y - half.y) / cell.y) - 1) * cell.y,
    right: (Math.ceil((view.x + half.x) / cell.x) + 1) * cell.x,
    bottom: (Math.ceil((view.y + half.y) / cell.y) + 1) * cell.y,
  };
}

const meets = (window: FloorWindow, box: FloorWindow) =>
  box.left < window.right &&
  box.right > window.left &&
  box.top < window.bottom &&
  box.bottom > window.top;

/**
 * Whether the 2D stage draws `item` in `window`: whether the floor it may
 * paint over — the circle round its box's centre that holds the box however
 * it is turned, and its overhang — meets the window.
 */
export function itemInWindow(window: FloorWindow, item: CanvasNode): boolean {
  const reach = Math.hypot(item.width, item.height, item.depth ?? 0) / 2 + ITEM_OVERHANG;
  const cx = item.x + item.width / 2;
  const cy = item.y + item.height / 2;
  return meets(window, {
    left: cx - reach,
    top: cy - reach,
    right: cx + reach,
    bottom: cy + reach,
  });
}

/** Each route's extent on the floor, worked out once per route (`edgeRoute` holds a route while its ends stay). */
const routeExtents = new WeakMap<EdgeRoute, FloorWindow>();

/** Whether the 2D stage draws the edge running `route` in `window`: whether its line, label and heads may. */
export function routeInWindow(window: FloorWindow, route: EdgeRoute): boolean {
  let extent = routeExtents.get(route);
  if (extent === undefined) {
    const points = routePoints(route);
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    extent = {
      left: Math.min(...xs) - ITEM_OVERHANG,
      top: Math.min(...ys) - ITEM_OVERHANG,
      right: Math.max(...xs) + ITEM_OVERHANG,
      bottom: Math.max(...ys) + ITEM_OVERHANG,
    };
    routeExtents.set(route, extent);
  }
  return meets(window, extent);
}
