/**
 * A corner handle's resize, read across the item's face: the box a resize
 * drag gives an item, as if it were unturned, the pointer's travel read
 * through its top view. The pointer reducer (`canvas-pointer.ts`) runs the
 * drag; this is the item it previews and writes.
 */
import { boxFrame, withBox, type CanvasNode } from "@kb/canvas";

const MIN_NODE_W = 80;
const MIN_NODE_H = 40;

interface Spot {
  readonly x: number;
  readonly y: number;
}

export type ResizeCorner = "nw" | "ne" | "se" | "sw";

/** A corner's resize under way: item `id` as it was when the drag went past the slop at `start`. */
export interface ResizeDrag {
  kind: "resize";
  id: string;
  corner: ResizeCorner;
  start: Spot;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
}

/**
 * A drag across the floor as a move across an item's face: the face's top
 * view is its own axes seen from above, so the drag is read back through
 * that view; a face seen edge-on takes no part of it.
 */
function acrossFace(node: CanvasNode, dx: number, dy: number): Spot {
  const m = boxFrame(node).matrix;
  const det = m[0] * m[4] - m[1] * m[3];
  if (Math.abs(det) < 1e-6) return { x: 0, y: 0 };
  return { x: (m[4] * dx - m[1] * dy) / det, y: (m[0] * dy - m[3] * dx) / det };
}

/**
 * `node` resized by `drag` to floor point `world`, in its own terms: as if
 * it were unturned, the pointer's travel read across its face
 * (`acrossFace`); ⇧ keeps its aspect.
 */
export function resizedItem(
  node: CanvasNode,
  drag: ResizeDrag,
  world: Spot,
  shiftKey: boolean,
): CanvasNode {
  const { x: dx, y: dy } = acrossFace(node, world.x - drag.start.x, world.y - drag.start.y);
  let w = drag.origW;
  let h = drag.origH;
  if (drag.corner === "se" || drag.corner === "ne") w = Math.max(MIN_NODE_W, drag.origW + dx);
  if (drag.corner === "sw" || drag.corner === "nw") w = Math.max(MIN_NODE_W, drag.origW - dx);
  if (drag.corner === "se" || drag.corner === "sw") h = Math.max(MIN_NODE_H, drag.origH + dy);
  if (drag.corner === "ne" || drag.corner === "nw") h = Math.max(MIN_NODE_H, drag.origH - dy);
  if (shiftKey && drag.origW > 0 && drag.origH > 0) {
    const ratio = drag.origW / drag.origH;
    if (w / h > ratio) w = Math.max(MIN_NODE_W, h * ratio);
    else h = Math.max(MIN_NODE_H, w / ratio);
  }
  const x = drag.corner.endsWith("w") ? drag.origX + drag.origW - w : drag.origX;
  const y = drag.corner.startsWith("n") ? drag.origY + drag.origH - h : drag.origY;
  const was = { ...node, x: drag.origX, y: drag.origY, width: drag.origW, height: drag.origH };
  return withBox(was, { x, y, width: w, height: h });
}
