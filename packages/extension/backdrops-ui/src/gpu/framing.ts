/**
 * Where a GPU backdrop's hero stands in its frame, by the frame's width.
 *
 * A page head is wide on a desktop page (the title at the left, the hero
 * right of it) and narrow in a side panel (420–600px, as bb shows a page),
 * where the title and the first rows cross most of the frame. Each backdrop
 * names two compositions, its panel one and its wide one, and the frame
 * eases between them by width: in a panel the hero is smaller, higher and
 * further right, and quieter, so it is calm behind the content.
 */

/** One composition of a hero in its frame. */
export interface Composition {
  /** The hero's centre, as shares of the frame from its left and its top. */
  readonly x: number;
  readonly y: number;
  /** The hero's size against its full-width size. */
  readonly scale: number;
  /** How present the scene is, against the strength's opacity. */
  readonly presence: number;
}

/** At or below this width the panel composition holds; at or above `WIDE`, the wide one. */
export const PANEL_WIDTH = 480;
export const WIDE_WIDTH = 900;

const smooth = (t: number) => {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
};

/** The composition for a frame `width` CSS pixels wide, between `panel` and `wide`. */
export function framingAt(width: number, panel: Composition, wide: Composition): Composition {
  const k = smooth((width - PANEL_WIDTH) / (WIDE_WIDTH - PANEL_WIDTH));
  const at = (a: number, b: number) => a + (b - a) * k;
  return {
    x: at(panel.x, wide.x),
    y: at(panel.y, wide.y),
    scale: at(panel.scale, wide.scale),
    presence: at(panel.presence, wide.presence),
  };
}
