/**
 * What a drawing drag writes when it is let go, read against the document
 * and the showing camera: the edge a port's drag or the arrow tool makes
 * between two items, and the item a placing tool's draft draws out. The
 * pointer reducer (`canvas-pointer.ts`) runs the drags; this is what their
 * release adds to the canvas, so both kinds of edge are one record.
 */
import {
  anchorNear,
  connectItems,
  isGroupNode,
  isTextNode,
  paintOrder,
  placeItems,
  sideTerminal,
  type CanvasDoc,
  type CanvasNode,
  type CanvasPresetKind,
  type CanvasSide,
} from "@kb/canvas";
import { hitTest, type CanvasView, type ViewSize } from "./canvas-camera";
import { selectEdge, selectNode, type CanvasSelection } from "./canvas-selection";
import { draftItem } from "./canvas-tool";

interface Spot {
  readonly x: number;
  readonly y: number;
}

/** What a release is read against: the reducer's `PointerContext` is one. */
interface DrawSurface {
  readonly doc: CanvasDoc;
  readonly byId: ReadonlyMap<string, CanvasNode>;
  readonly view: CanvasView;
  readonly size: ViewSize;
}

/**
 * A placing tool's draft (`draftItem`): item `id` of `preset`, drawn out
 * from `from` on the floor; `on`, the item an arrow is drawn from, bound
 * by edge `edgeId` when it ends on another. `slop` is where the press went
 * down on screen until the pointer has gone past the slop: a draft let go
 * before then is a click.
 */
export interface DraftDrag {
  kind: "draft";
  id: string;
  preset: CanvasPresetKind;
  from: Spot;
  on: string | null;
  edgeId: string;
  bindingId: string;
  slop: Spot | null;
}

/** What a release writes: the document, what it selects, and how it is kept. */
export interface Drawn {
  doc: CanvasDoc;
  selection: CanvasSelection;
  persist: "history" | "flush";
  /** An item to open for typing once this is written: the text card a draft placed. */
  edit?: string;
}

/** `doc` without item `id`: a stroke's or a draft's preview taken away before what it ends as is written. */
export function without(doc: CanvasDoc, id: string): CanvasDoc {
  return { ...doc, nodes: doc.nodes.filter((n) => n.id !== id) };
}

/** The side of `node` whose port is nearest the floor point (`px`, `py`). */
function closestPort(node: CanvasNode, px: number, py: number): CanvasSide {
  const sides: CanvasSide[] = ["top", "right", "bottom", "left"];
  let best: { side: CanvasSide; dist: number } = { side: "left", dist: Infinity };
  for (const side of sides) {
    const point = sideTerminal(node, side).at;
    const dist = Math.hypot(point.x - px, point.y - py);
    if (dist < best.dist) best = { side, dist };
  }
  return best.side;
}

/** An edge's two record ids, made by the press that drew it. */
interface EdgeIds {
  readonly id: string;
  readonly bindingId: string;
}

/**
 * The edge drawn from `from`'s side `fromSide` to `to`, let go at `world`:
 * with ⌘ held (`free`) its end lands precisely where it was dropped on the
 * item's outline (`anchorNear`), else at the side nearest the drop. It is
 * the one edge record an agent's `connect` makes too (`connectItems`).
 */
export function edgeDrawn(
  doc: CanvasDoc,
  ids: EdgeIds,
  from: { readonly node: CanvasNode; readonly side: CanvasSide },
  to: { readonly node: CanvasNode; readonly world: Spot; readonly free: boolean },
): Drawn {
  const lands = to.free
    ? { toAnchor: anchorNear(to.node, to.world) }
    : { toSide: closestPort(to.node, to.world.x, to.world.y) };
  const bound = connectItems(doc, {
    id: ids.id,
    bindingId: ids.bindingId,
    from: from.node.id,
    to: to.node.id,
    fromSide: from.side,
    ...lands,
  });
  return { doc: bound.doc, selection: selectEdge(bound.edge.id), persist: "flush" };
}

/**
 * The item an arrow drawn from `on` ends on at `screen`, which it is bound
 * to: the topmost under the pointer that is neither `on` itself nor a frame
 * (an arrow ends inside a frame on what is there), or none.
 */
function arrowTarget(surface: DrawSurface, doc: CanvasDoc, on: string, screen: Spot) {
  const hit = hitTest(paintOrder(doc.nodes), surface.view, surface.size, screen);
  const item = hit === null || hit === on ? undefined : surface.byId.get(hit);
  return item === undefined || isGroupNode(item) ? null : item;
}

/**
 * The release of a draft at floor point `to` (`screen` on screen): a click
 * places its preset centred where it was pressed (an arrow clicked on an
 * item draws nothing: null); a drag writes what it drew, an arrow drawn
 * from one item to another as the edge between them, each end leaving its
 * item on the side that faces the other (`edgeDrawn`), and anything else as
 * the item, placed in its frame. Either is one history step, and is selected.
 */
export function draftDrawn(
  surface: DrawSurface,
  drag: DraftDrag,
  release: { readonly to: Spot; readonly screen: Spot; readonly shiftKey: boolean },
): Drawn | null {
  const doc = without(surface.doc, drag.id);
  const clicked = drag.slop !== null;
  if (clicked && drag.on !== null) return null;
  const { to } = release;
  const from = drag.on === null ? undefined : surface.byId.get(drag.on);
  const target =
    from === undefined || clicked ? null : arrowTarget(surface, doc, from.id, release.screen);
  if (from !== undefined && target !== null) {
    const ids = { id: drag.edgeId, bindingId: drag.bindingId };
    const side = closestPort(from, to.x, to.y);
    return edgeDrawn(
      doc,
      ids,
      { node: from, side },
      { node: target, world: drag.from, free: false },
    );
  }
  // GAP [[01M5QP271PQ15E7WZ36KEN055N]] an arrow from an item to nothing is drawn free, not bound at its start
  const item = draftItem(drag.preset, drag.id, drag.from, clicked ? null : to, release.shiftKey);
  return {
    doc: placeItems(doc, [item]),
    selection: selectNode(item.id),
    persist: "history",
    ...(isTextNode(item) ? { edit: item.id } : {}),
  };
}
