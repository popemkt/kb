/**
 * Where a page head's backdrop shows its corner (`BackdropCorner`;
 * DESIGN-UI.md → Page-head backdrops → Its actions), measured from the top
 * of the head's breathing room, which the page's title follows.
 */
import type { BackdropPresentation } from "./plugins";

/** How far the corner keeps inside its frame's top edge, and above the title. */
export const CORNER_INSET = 8;
/** The height of the corner's buttons. */
export const CORNER_HEIGHT = 28;

/**
 * The corner's top, in px from the top of the breathing room, `room` px
 * tall: inside the frame's top edge (at `offset`), unless that would bring
 * it down on the title; then lifted until it clears the title, above it.
 */
export function cornerTop({ offset }: Pick<BackdropPresentation, "offset">, room: number): number {
  return Math.min(offset + CORNER_INSET, room - CORNER_INSET - CORNER_HEIGHT);
}
