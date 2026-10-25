/**
 * The shoulder: the tone curve a scene picks when its ground must meet the
 * page around it to the level (a page-head backdrop). ACES and AgX bend the
 * whole range, so the ground they hand back is not the page's, and a frame
 * drawn with them shows as a rectangle. The shoulder is the identity up to
 * a knee and compresses only above it, smoothly (its slope is 1 at the knee)
 * and toward white, so highlights still roll off as on film.
 *
 * A light page's ground sits above the knee, in the shoulder, so a scene
 * that paints the page's colour paints the ground's pre-image
 * (`shoulderGround`): the value the curve takes to the page's colour.
 */
import { exp, log, max, min, vec3 } from "three/tsl";
import type { TslNode } from "./tsl";

/** Where the shoulder starts: below this the curve is the identity. */
export const SHOULDER_KNEE = 0.8;

const SPAN = 1 - SHOULDER_KNEE;

/** The shoulder on a linear colour, per channel. */
export function shoulder(color: TslNode<"vec3">): TslNode<"vec3"> {
  const over = max(color.sub(SHOULDER_KNEE), vec3(0, 0, 0));
  return color.min(SHOULDER_KNEE).add(
    vec3(1, 1, 1)
      .sub(exp(over.div(-SPAN)))
      .mul(SPAN),
  );
}

/** The pre-image of `color` under the shoulder: what a scene paints to show `color`. */
export function shoulderGround(color: TslNode<"vec3">): TslNode<"vec3"> {
  const over = min(max(color.sub(SHOULDER_KNEE), vec3(0, 0, 0)), vec3(SPAN * 0.999));
  return color.min(SHOULDER_KNEE).add(log(vec3(1, 1, 1).sub(over.div(SPAN))).mul(-SPAN));
}
