/**
 * The head's text over a GPU backdrop: where the title and the meta row
 * under it sit in the frame, and a soft mask over just that block, so a
 * scene can keep its detail out from under the glyphs and lay a light
 * scrim there (darker under light text on a dark page, paler under dark
 * text on a light one) without washing the rest of the picture.
 *
 * Measured in the outline's head, in CSS pixels from the frame's top-left:
 * the title row starts at its left edge about 130px down, and the field row
 * under it ends about 195px down. A title's length is not known here, so
 * the block reaches a usual title's width and fades out well past it.
 */
import { smoothstep, uniform } from "three/tsl";
import { Vector4 } from "three/webgpu";
import type { TslNode } from "@kb/scene-gpu";

/** The block, CSS pixels from the frame's left and top: its right edge, its top and its bottom. */
const TEXT_RIGHT = 400;
const TEXT_TOP = 122;
const TEXT_BOTTOM = 200;
/** How far the mask fades out past the block, across and down (CSS pixels). */
const FADE_ACROSS = 140;
const FADE_DOWN = 26;

/** A scene's text mask: lay it out from the frame's size, read it in the shader. */
export function textScrim() {
  // The block as shares of the frame: right edge, top, bottom, and the fades.
  const block = uniform(new Vector4(0.4, 0.34, 0.56, 0.14));
  const fadeDown = uniform(0.07);
  return {
    /** Lay the block out for a frame `width` × `height` CSS pixels. */
    layout: (width: number, height: number) => {
      const w = Math.max(1, width);
      const h = Math.max(1, height);
      block.value.set(
        Math.min(TEXT_RIGHT, w * 0.8) / w,
        TEXT_TOP / h,
        TEXT_BOTTOM / h,
        FADE_ACROSS / w,
      );
      fadeDown.value = FADE_DOWN / h;
    },
    /** 1 under the text block, falling softly to 0 away from it; `at` is the frame's UV with y up. */
    under: (at: TslNode<"vec2">): TslNode<"float"> => {
      const fromTop = at.y.oneMinus();
      return smoothstep(block.x.add(block.w), block.x, at.x)
        .mul(smoothstep(block.y.sub(fadeDown), block.y, fromTop))
        .mul(smoothstep(block.z.add(fadeDown), block.z, fromTop));
    },
  };
}
