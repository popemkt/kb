/**
 * How the dock (`CanvasDock`) stands on the stage, CSS pixels: so wide a
 * panel (four 40px picks across, as tldraw's style panel), so far in from
 * the stage's right edge. What stands beside something on the stage keeps
 * clear of `DOCK_RESERVE` at the right, where the dock's panels are.
 */
export const DOCK_PANEL_WIDTH = 176;
const DOCK_INSET = 12;
export const DOCK_RESERVE = DOCK_PANEL_WIDTH + 2 * DOCK_INSET;
