import { useMemo, useSyncExternalStore } from "react";
import { viewOfPan, type CanvasPoint, type CanvasView, type ViewSize } from "./canvas-camera";
import type { CanvasCameraRig } from "./canvas-camera-rig";

/** The camera the showing projection draws with, and the stage it draws on. */
export interface ShownCamera {
  readonly view: CanvasView;
  readonly size: ViewSize;
}

/** What a layer drawn over the stage is told of the camera, for `useShownCamera`. */
export interface ShownCameraProps {
  readonly rig: CanvasCameraRig;
  /** The 3D scene is the one showing (otherwise the view is the top view of `pan` and `zoom`). */
  readonly in3d: boolean;
  readonly pan: CanvasPoint;
  readonly zoom: number;
  /** The stage's size, CSS pixels. */
  readonly width: number;
  readonly height: number;
}

/**
 * The showing projection's camera on a stage of `width` × `height`, kept
 * current: in 3D the rig's view, on every frame it moves; in 2D the top
 * view of the page's `pan` and `zoom` on that stage. What is drawn over
 * either projection from the camera model reads it here, so the view and
 * the size it is projected on are one reading — never a view made for one
 * size drawn on another, which would set what is drawn over the stage off
 * what it marks after a resize. One object while nothing it is made of
 * changes, so what is memoised on it holds.
 */
export function useShownCamera({
  rig,
  in3d,
  pan,
  zoom,
  width,
  height,
}: ShownCameraProps): ShownCamera {
  const live = useSyncExternalStore(rig.subscribe, () => rig.view);
  const size = useMemo(() => ({ width, height }), [width, height]);
  const flat = useMemo(() => ({ view: viewOfPan(pan, zoom, size), size }), [pan, zoom, size]);
  const shown = useMemo(() => ({ view: live, size }), [live, size]);
  return in3d ? shown : flat;
}
