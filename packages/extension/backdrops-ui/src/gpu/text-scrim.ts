/**
 * The head's text over a GPU backdrop: where the title, its tags and the
 * meta line sit in the frame, and a soft mask over that block, so a scene
 * can keep its detail out from under the text and lay a scrim there (darker
 * under light text on a dark page, paler under dark text on a light one).
 *
 * Measured in the outline's head: in a wide frame the block is the left
 * part, a little above the middle; in a side panel it crosses the frame.
 * Between the two it eases by width, as the compositions do (`framing.ts`).
 */
import { smoothstep, uniform } from "three/tsl";
import { Vector4 } from "three/webgpu";
import type { TslNode } from "@kb/scene-gpu";
import { PANEL_WIDTH, WIDE_WIDTH } from "./framing";

/** The text block as shares of the frame from its left and its top: x0, y0, x1, y1. */
const TEXT_WIDE = [0, 0.3, 0.42, 0.62] as const;
const TEXT_PANEL = [0, 0.3, 0.92, 0.66] as const;
/** How soft the mask's edges are, in shares of the frame. */
const SOFT = 0.06;

/** A scene's text mask: set it from the frame's width, read it in the shader. */
export function textScrim() {
  const block = uniform(new Vector4(...TEXT_WIDE));
  return {
    /** Lay the block out for a frame `width` CSS pixels wide. */
    layout: (width: number) => {
      const k = Math.min(1, Math.max(0, (width - PANEL_WIDTH) / (WIDE_WIDTH - PANEL_WIDTH)));
      const [x0, y0, x1, y1] = TEXT_PANEL.map((p, i) => p + ((TEXT_WIDE[i] ?? p) - p) * k);
      block.value.set(x0 ?? 0, y0 ?? 0, x1 ?? 0, y1 ?? 0);
    },
    /** 1 under the text block, 0 away from it; `at` is the frame's UV with y up. */
    under: (at: TslNode<"vec2">): TslNode<"float"> => {
      const fromTop = at.y.oneMinus();
      return smoothstep(block.x.sub(SOFT), block.x.add(SOFT), at.x)
        .mul(smoothstep(block.z.add(SOFT), block.z.sub(SOFT), at.x))
        .mul(smoothstep(block.y.sub(SOFT), block.y.add(SOFT), fromTop))
        .mul(smoothstep(block.w.add(SOFT), block.w.sub(SOFT), fromTop));
    },
  };
}
