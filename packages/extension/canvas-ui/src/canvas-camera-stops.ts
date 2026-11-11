/**
 * The canvas camera's stops: the fixed values every surface that moves the
 * camera agrees on. They are the zoom's bounds and step, how far the orbit
 * tips, and the orientations a person can name. The camera's math
 * (`canvas-camera.ts`) reads them. They stand apart from it, so a table that
 * only names a view or a step, such as the canvas's keys
 * (`canvas-keys.ts`), carries none of that math.
 */
import type { CanvasViewPresetName } from "@kb/contracts";

/**
 * Zoom bounds and step, owned here because every surface that changes zoom —
 * the wheel, the keymap, zoom-to-fit, an orbit's dolly — has to agree on them.
 */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 3;
export const ZOOM_STEP = 1.15;

/** An orbit tips no further than level with the floor, radians, and never under it. */
export const MAX_PITCH = Math.PI / 2;

/**
 * The named orientations of the orbit, Blender's numpad views: from the top
 * (the 2D view's), level from each side, and the oblique look a canvas first
 * opens at in 3D. Each side is named for where the eye stands — `front` on
 * the +y side, looking across the floor with x to the right; `right` on +x.
 */

export interface ViewPresetSpec {
  readonly label: string;
  readonly yaw: number;
  readonly pitch: number;
}

export const CANVAS_VIEW_PRESETS: { readonly [P in CanvasViewPresetName]: ViewPresetSpec } = {
  top: { label: "Top", yaw: 0, pitch: 0 },
  front: { label: "Front", yaw: 0, pitch: MAX_PITCH },
  right: { label: "Right", yaw: -Math.PI / 2, pitch: MAX_PITCH },
  back: { label: "Back", yaw: Math.PI, pitch: MAX_PITCH },
  left: { label: "Left", yaw: Math.PI / 2, pitch: MAX_PITCH },
  oblique: { label: "Oblique", yaw: -0.4, pitch: 0.85 },
};
