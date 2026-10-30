/**
 * The head's text over a GPU backdrop: where the title and the meta row
 * under it sit in the frame, and a soft mask over just that block, so a
 * scene can keep its detail out from under the glyphs and lay a light
 * scrim there (darker under light text on a dark page, paler under dark
 * text on a light one) without washing the rest of the picture.
 *
 * Measured in the outline's head, in CSS pixels from the content's
 * top-left (`ContentBox`; the frame may span wider than the content): the
 * title row starts at its left edge about 130px down, and the field row
 * under it ends about 195px down. A title's length is not known here, so
 * the block reaches a usual title's width and fades out well past it.
 */
import { smoothstep, uniform } from "three/tsl";
import { Vector2, Vector4 } from "three/webgpu";
import type { TslNode } from "@kb/scene-gpu";
import type { ContentBox } from "./framing";

/** The block, CSS pixels from the content's left and the frame's top: its right edge, its top and its bottom. */
const TEXT_RIGHT = 400;
const TEXT_TOP = 122;
const TEXT_BOTTOM = 200;
/** How far the mask fades out past the block, across and down (CSS pixels). */
const FADE_ACROSS = 140;
const FADE_DOWN = 26;

/** A scene's text mask: lay it out from the frame's size and its content, read it in the shader. */
export function textScrim() {
  // The block as shares of the frame: left and right edges, top, bottom; then the fades.
  const block = uniform(new Vector4(0, 0.4, 0.34, 0.56));
  const fade = uniform(new Vector2(0.14, 0.07));
  return {
    /** Lay the block out for a frame `width` × `height` CSS pixels whose content is `content`. */
    layout: ({
      width,
      height,
      content,
    }: {
      readonly width: number;
      readonly height: number;
      readonly content: ContentBox;
    }) => {
      const w = Math.max(1, width);
      const h = Math.max(1, height);
      block.value.set(
        content.left / w,
        (content.left + Math.min(TEXT_RIGHT, content.width * 0.8)) / w,
        TEXT_TOP / h,
        TEXT_BOTTOM / h,
      );
      fade.value.set(FADE_ACROSS / w, FADE_DOWN / h);
    },
    /** 1 under the text block, falling softly to 0 away from it; `at` is the frame's UV with y up. */
    under: (at: TslNode<"vec2">): TslNode<"float"> => {
      const fromTop = at.y.oneMinus();
      return smoothstep(block.x.sub(fade.x), block.x, at.x)
        .mul(smoothstep(block.y.add(fade.x), block.y, at.x))
        .mul(smoothstep(block.z.sub(fade.y), block.z, fromTop))
        .mul(smoothstep(block.w.add(fade.y), block.w, fromTop));
    },
  };
}
