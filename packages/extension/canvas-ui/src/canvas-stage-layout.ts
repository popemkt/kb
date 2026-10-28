/**
 * How the stage stands its chrome, by its size (DESIGN-UI.md → Canvas →
 * The compact stage): one answer every piece of chrome reads, so a phone,
 * held either way, and a side panel's narrow stage are laid out alike.
 *
 * A compact stage is narrower than `COMPACT_WIDTH` (a phone upright, a side
 * panel) or shorter than `COMPACT_HEIGHT` (a phone on its side). There the
 * tools stand in one row along the bottom, the rest behind More, as
 * tldraw's and Excalidraw's do on a phone; the dock's panels stand folded
 * to their titles, as tldraw's style panel waits behind a button; the view
 * widget folds its axis gizmo away; and the selection toolbar shows marks
 * rather than words, above the tools.
 */
import type { ViewSize } from "./canvas-camera";

const COMPACT_WIDTH = 720;
const COMPACT_HEIGHT = 480;

/** Whether a stage of `size` is compact. A stage not yet measured (0 × 0) is not. */
export function compactStage(size: ViewSize): boolean {
  if (size.width === 0 && size.height === 0) return false;
  return size.width < COMPACT_WIDTH || size.height < COMPACT_HEIGHT;
}

/** Where the tools stand on a compact stage: a step above its bottom edge, clear of the safe area (a phone's home bar). */
export const STRIP_BOTTOM = "bottom-[max(0.5rem,env(safe-area-inset-bottom))]";

/**
 * Where the bar at the bottom of the stage stands (the selection toolbar,
 * present mode's bar, a modal transform's readout): over the bottom edge,
 * or on a compact stage above the tools that stand there.
 */
export const bottomBarClass = (compact: boolean): string =>
  compact ? "bottom-[calc(max(0.5rem,env(safe-area-inset-bottom))+3.5rem)]" : "bottom-4";

/** Where the dock's column ends: above the bottom bar, which it never runs under. */
export const dockBottomClass = (compact: boolean): string => (compact ? "bottom-28" : "bottom-16");
