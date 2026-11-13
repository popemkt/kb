/**
 * How Backdrop Studio frames a scene (DESIGN-UI.md → Backdrop Studio →
 * Framing): the size the scene is drawn at, which preview says, and the
 * zoom and pan that show it in the studio's viewport. The scene is laid out
 * at its own size and scaled on screen, so at 1:1 a pixel of it is a pixel
 * of the page, and its frame meter measures what a page would pay.
 */
import type { BackdropPresentation } from "@kb/appearance-kit";

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A custom preview's proportions, width to height. */
export const ASPECTS = [
  { id: "16:9", label: "16:9", width: 16, height: 9 },
  { id: "4:3", label: "4:3", width: 4, height: 3 },
  { id: "1:1", label: "1:1", width: 1, height: 1 },
  { id: "9:16", label: "9:16", width: 9, height: 16 },
] as const;

export type AspectId = (typeof ASPECTS)[number]["id"];

/**
 * What the scene is drawn as: the strip a page head draws it in (`head`,
 * its presentation's height across the page), the whole page (`page`, the
 * studio's viewport, as it opens), or a frame of chosen proportions
 * (`aspect`).
 */
export type Preview =
  | { readonly kind: "head" }
  | { readonly kind: "page" }
  | { readonly kind: "aspect"; readonly aspect: AspectId };

/** The scene's own size for `preview`, in a viewport of `viewport`. */
export function sceneSize(
  preview: Preview,
  viewport: Size,
  presentation: Pick<BackdropPresentation, "height">,
): Size {
  if (preview.kind === "head") return { width: viewport.width, height: presentation.height };
  if (preview.kind === "page") return viewport;
  const aspect = ASPECTS.find(({ id }) => id === preview.aspect) ?? ASPECTS[0];
  return {
    width: viewport.width,
    height: Math.round((viewport.width * aspect.height) / aspect.width),
  };
}

/** How far a person zooms out and in; a fit may go further out (`fitScale`). */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
/** The steps zooming in and out stops at. */
const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;

/**
 * The zoom: fitted to the viewport, whatever its size (`fit`), or a scale
 * the person chose, 1 being the scene's own pixels.
 */
export type Zoom = "fit" | number;

/**
 * The scale that shows the whole scene in the viewport: never above
 * `MAX_ZOOM`, and below `MIN_ZOOM` when that is what the whole scene
 * takes, since a fit that crops is not one.
 */
export function fitScale(scene: Size, viewport: Size): number {
  if (scene.width <= 0 || scene.height <= 0 || viewport.width <= 0 || viewport.height <= 0)
    return 1;
  return Math.min(MAX_ZOOM, viewport.width / scene.width, viewport.height / scene.height);
}

/** The scale `zoom` draws at, for `scene` in `viewport`. */
export function scaleOf(zoom: Zoom, scene: Size, viewport: Size): number {
  return zoom === "fit" ? fitScale(scene, viewport) : zoom;
}

/** The next step in from `scale`: the first above it. */
export function zoomIn(scale: number): number {
  return ZOOM_STEPS.find((step) => step > scale + 1e-6) ?? MAX_ZOOM;
}

/** The next step out from `scale`: the last below it, or `scale` itself where none is (a fit below every step). */
export function zoomOut(scale: number): number {
  return ZOOM_STEPS.findLast((step) => step < scale - 1e-6) ?? scale;
}

/** One axis of `placeScene`: centred where it fits, else held inside. */
function placeAxis(at: number | undefined, size: number, room: number): number {
  const centred = (room - size) / 2;
  if (size <= room) return centred;
  return Math.min(0, Math.max(room - size, at ?? centred));
}

/**
 * Where the scaled scene's top-left stands in the viewport, given `pan`
 * (null: centred). On an axis where it fits it is centred, however it was
 * panned; on one where it is larger, it is held so no edge comes inside
 * the viewport's.
 */
export function placeScene(pan: Point | null, scaled: Size, viewport: Size): Point {
  return {
    x: placeAxis(pan?.x, scaled.width, viewport.width),
    y: placeAxis(pan?.y, scaled.height, viewport.height),
  };
}

/** Whether the scaled scene is larger than the viewport on either axis: whether there is anywhere to pan. */
export function canPan(scaled: Size, viewport: Size): boolean {
  return scaled.width > viewport.width + 0.5 || scaled.height > viewport.height + 0.5;
}

/**
 * The pan that keeps the viewport's centre on the same point of the scene
 * when its scale goes from `from` to `to`, from where it stood (`at`).
 */
export function zoomAboutCentre(at: Point, from: number, to: number, viewport: Size): Point {
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;
  return { x: cx - ((cx - at.x) * to) / from, y: cy - ((cy - at.y) * to) / from };
}
