import {
  canvasTop,
  edgeReach,
  edgeRoute,
  pinnedItems,
  routeMidpoint,
  routePoints,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasItemLink,
  type CanvasNode,
  type CanvasThread,
  type EdgeRoute,
  type CommentAnchor,
} from "@kb/canvas";
import { hasText, type ScreenRegion } from "@kb/ui-sdk";
import { labelReach, restingReach } from "./canvas-chrome";
import type { PressChrome } from "./canvas-projections";
import {
  projectPoint,
  screenBounds,
  type CanvasPoint,
  type CanvasScreenPoint,
  type CanvasHitItem,
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

/**
 * What a comment thread is on as `view` draws it on a stage of `size`: the
 * screen box of each item it is pinned on (`pinnedItems`), or its point on
 * the floor as a box of no size. None where nothing it is on is in front of
 * the eye, and none for a pin that is lost (the lint's `orphan-comment`).
 */
export function anchorRects(
  anchor: CommentAnchor | null,
  doc: CanvasDoc,
  view: CanvasView,
  size: ViewSize,
): { readonly item: string | null; readonly rect: ScreenRect }[] {
  if (anchor === null) return [];
  if ("at" in anchor) {
    const at = projectPoint(view, size, { ...anchor.at, z: 0 });
    return at === null
      ? []
      : [{ item: null, rect: { left: at.x, top: at.y, right: at.x, bottom: at.y } }];
  }
  return [...itemScreenRects(pinnedItems(anchor, doc), view, size)].map(([item, rect]) => ({
    item,
    rect,
  }));
}

/**
 * What the camera frames to show a thread: the items it is pinned on, or a
 * stretch of floor about its point as wide as the stage shows now, so the
 * point comes to the middle at the zoom it has.
 */
export function anchorFrame(
  anchor: CommentAnchor | null,
  doc: CanvasDoc,
  view: CanvasView,
  size: ViewSize,
): CanvasHitItem[] {
  if (anchor === null) return [];
  if (!("at" in anchor)) return pinnedItems(anchor, doc);
  if (view.zoom <= 0) return [];
  const [width, height] = [size.width / view.zoom, size.height / view.zoom];
  const { x, y } = anchor.at;
  return [{ id: "", x: x - width / 2, y: y - height / 2, width, height }];
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
 * of each box it is on (`anchorRects`), which for a point is the point.
 */
export function threadPins(
  threads: readonly CanvasThread[],
  doc: CanvasDoc,
  view: CanvasView,
  size: ViewSize,
): ThreadPin[] {
  return threads.flatMap((thread) =>
    anchorRects(thread.anchor, doc, view, size).map(({ item, rect }) => ({
      thread,
      item,
      at: { x: rect.right, y: rect.top },
    })),
  );
}

/** Where an item's link mark stands on the stage: the bottom right corner it hangs from. */
export interface LinkMark {
  readonly item: string;
  readonly link: CanvasItemLink;
  readonly at: CanvasPoint;
}

/**
 * Where `view` hangs the link mark of each item of `doc` that carries a
 * link, on a stage of `size`: at the bottom right of its box as drawn
 * (`itemScreenRects`); none for an item none of which is in front of the eye.
 */
export function linkMarks(doc: CanvasDoc, view: CanvasView, size: ViewSize): LinkMark[] {
  const linked = doc.nodes.filter((item) => item.link !== undefined);
  const rects = itemScreenRects(linked, view, size);
  return linked.flatMap(({ id, link }) => {
    const rect = rects.get(id);
    return rect === undefined || link === undefined
      ? []
      : [{ item: id, link, at: { x: rect.right, y: rect.bottom } }];
  });
}

/**
 * The item of `items` a point on a stage of `size` falls on as `view` draws
 * them: the smallest whose screen box holds it, so a member wins over the
 * frame round it. Null over none.
 */
export function itemUnder(
  items: readonly CanvasNode[],
  view: CanvasView,
  size: ViewSize,
  point: CanvasPoint,
): string | null {
  let under: { id: string; area: number } | null = null;
  for (const [id, r] of itemScreenRects(items, view, size)) {
    if (point.x < r.left || point.x > r.right || point.y < r.top || point.y > r.bottom) continue;
    const area = (r.right - r.left) * (r.bottom - r.top);
    if (under === null || area < under.area) under = { id, area };
  }
  return under?.id ?? null;
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
 * it is turned, and what it paints past it at rest (`restingReach`) —
 * meets the window. A selected item is drawn wherever it is, so its
 * handles are not reached for.
 */
export function itemInWindow(window: FloorWindow, item: CanvasNode): boolean {
  const reach =
    Math.hypot(item.width, item.height, item.depth ?? 0) / 2 + restingReach(canvasTop(item));
  const cx = item.x + item.width / 2;
  const cy = item.y + item.height / 2;
  return meets(window, {
    left: cx - reach,
    top: cy - reach,
    right: cx + reach,
    bottom: cy + reach,
  });
}

/**
 * Each route's extent on the floor, worked out once per route. A route is
 * made for one edge record (`edgeRoute` holds it while that record and its
 * ends stay), so the edge's look and label it is measured with are its own.
 */
const routeExtents = new WeakMap<EdgeRoute, FloorWindow>();

/**
 * Whether the 2D stage draws `edge`, running `route`, in `window`: whether
 * its line and heads (`edgeReach`) or its label about the route's middle
 * (`labelReach`, as a press reaches it) meet the window.
 */
export function routeInWindow(window: FloorWindow, edge: CanvasEdge, route: EdgeRoute): boolean {
  let extent = routeExtents.get(route);
  if (extent === undefined) {
    const points = routePoints(route);
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const line = edgeReach(edge);
    extent = {
      left: Math.min(...xs) - line,
      top: Math.min(...ys) - line,
      right: Math.max(...xs) + line,
      bottom: Math.max(...ys) + line,
    };
    if (hasText(edge.label)) {
      const at = routeMidpoint(route);
      const { halfWidth, halfHeight } = labelReach(edge.label);
      extent = {
        left: Math.min(extent.left, at.x - halfWidth),
        top: Math.min(extent.top, at.y - halfHeight),
        right: Math.max(extent.right, at.x + halfWidth),
        bottom: Math.max(extent.bottom, at.y + halfHeight),
      };
    }
    routeExtents.set(route, extent);
  }
  return meets(window, extent);
}

const clamp = (v: number, low: number, high: number) => Math.max(low, Math.min(v, high));

/** How far a panel stands off what it is beside, and off the stage's edges, CSS pixels. */
const BESIDE_GAP = 12;

/**
 * Where a panel of `panel` size stands on a stage of `size` beside `target`
 * (the screen boxes of what it is about), never over it: to its right, else
 * to its left, else under it, else over it, kept `BESIDE_GAP` inside the
 * stage less `reserve` on its right (the dock). Its top lines up with the
 * target's beside it, its left with the target's under or over it.
 */
export function placeBeside(
  target: readonly ScreenRect[],
  panel: ViewSize,
  size: ViewSize,
  reserve: number,
): CanvasPoint {
  const right = size.width - reserve - BESIDE_GAP;
  const fitX = (x: number) => clamp(x, BESIDE_GAP, right - panel.width);
  const fitY = (y: number) => clamp(y, BESIDE_GAP, size.height - BESIDE_GAP - panel.height);
  if (target.length === 0) {
    return { x: fitX((right - panel.width) / 2), y: fitY((size.height - panel.height) / 2) };
  }
  const box = {
    left: Math.min(...target.map((r) => r.left)),
    top: Math.min(...target.map((r) => r.top)),
    right: Math.max(...target.map((r) => r.right)),
    bottom: Math.max(...target.map((r) => r.bottom)),
  };
  if (box.right + BESIDE_GAP + panel.width <= right) {
    return { x: box.right + BESIDE_GAP, y: fitY(box.top) };
  }
  if (box.left - BESIDE_GAP - panel.width >= BESIDE_GAP) {
    return { x: box.left - BESIDE_GAP - panel.width, y: fitY(box.top) };
  }
  if (box.bottom + BESIDE_GAP + panel.height <= size.height - BESIDE_GAP) {
    return { x: fitX(box.left), y: box.bottom + BESIDE_GAP };
  }
  return { x: fitX(box.left), y: fitY(box.top - BESIDE_GAP - panel.height) };
}
