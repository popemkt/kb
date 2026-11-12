/**
 * Where a page head's backdrop shows its corner (`BackdropCorner`;
 * DESIGN-UI.md → Page-head backdrops → Its actions), measured from the top
 * of the head's breathing room, which the page's title follows.
 */
import type { BackdropPresentation } from "./appearance-points.ts";

/** How far the corner keeps inside its frame's top edge, and above the title. */
export const CORNER_INSET = 8;
/** The height of the corner's buttons. */
export const CORNER_HEIGHT = 28;

/**
 * The corner's top, in px from the top of the breathing room, `room` px
 * tall: inside the frame's top edge (at `offset`), unless that would bring
 * it down on the title; then lifted until it clears the title, above it.
 * Never above the breathing room's own top, inset: a frame may start
 * higher, behind the page's header (a negative `offset`), and a corner
 * there would sit under the header's edge. Where the room is too short
 * for both, the inset wins, since a corner under the header cannot be
 * used, and one beside the title's line still can.
 */
export function cornerTop({ offset }: Pick<BackdropPresentation, "offset">, room: number): number {
  return Math.max(
    CORNER_INSET,
    Math.min(offset + CORNER_INSET, room - CORNER_INSET - CORNER_HEIGHT),
  );
}
