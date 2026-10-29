/**
 * Where a GPU backdrop's hero stands in its frame (DESIGN-UI.md → Page-head
 * backdrops → GPU scenes → Framing by width).
 *
 * The head keeps one height whatever its width, so a hero is composed from
 * the height and an anchor, never from the width: its size is a share of
 * the height, and its place is so many heights from the centre of the
 * head's content, the column the title stands in. A wider frame (a wider
 * window, the full content width) adds field at the sides; the hero stays
 * where it was, as large as it was.
 *
 * A page head is wide on a desktop page (the title at the left, the hero
 * right of it) and narrow in a side panel (420–600px, as bb shows a page)
 * or on a phone, where the title and the first rows cross most of the
 * frame. Each backdrop names two compositions, its panel one and its wide
 * one, and the frame eases between them by its own width: in a panel the
 * hero is smaller, higher and further right, and quieter, so it is calm
 * behind the content.
 */

/** One composition of a hero, against the frame's height. */
export interface Composition {
  /** The hero's centre: heights right of the content's centre (left, negative). */
  readonly x: number;
  /** The hero's centre: a share of the frame's height from its top. */
  readonly y: number;
  /** The hero's size against its wide size. */
  readonly scale: number;
  /** How present the scene is, against the strength's opacity. */
  readonly presence: number;
}

/** Where the head's content (the title's column) lies across the frame, CSS pixels from its left. */
export interface ContentBox {
  readonly left: number;
  readonly width: number;
}

/**
 * Where a hero stands, in frame units: the frame's height is 1, its centre
 * the origin, y up; `scale` is the composition's.
 */
export interface Anchor {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
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

/** Where `composition` puts the hero in a frame `width` × `height` whose content is `content`. */
export function anchorIn(
  composition: Composition,
  frame: { readonly width: number; readonly height: number },
  content: ContentBox,
): Anchor {
  const centre = (content.left + content.width / 2 - frame.width / 2) / frame.height;
  return { x: centre + composition.x, y: 0.5 - composition.y, scale: composition.scale };
}
