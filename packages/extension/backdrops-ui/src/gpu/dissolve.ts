/**
 * How a GPU backdrop's art dissolves into the page by its own shape, never
 * by the frame's (DESIGN-UI.md → Page-head backdrops → GPU scenes): the
 * stage's feather fades along the frame's sides, and anything still there
 * when it begins reads as a box. So a scene's art keeps to a reach about its
 * composition, an ellipse that noise eats into, and is gone before any side.
 *
 * - `reachWithin` (CPU): the reach a scene asks for about its composition,
 *   slid toward the frame's centre as far as it must, and only then cut, so
 *   it clears every side by a margin. Noise only ever eats in, so the art is
 *   gone at the ellipse whatever the noise does.
 * - `keptAt` (CPU): how much of a whole thing at a point is kept, 1 well
 *   inside the reach and 0 at its rim, for what fades as a whole (a shard,
 *   an orb) rather than pixel by pixel.
 * - `dissolve` (GPU): per pixel, 1 inside, easing to 0 at a rim the noise
 *   eats into, so the edge is ragged and slow, never a line.
 */
import { Fn, clamp, float, length, smoothstep as fade, uniform, vec2 } from "three/tsl";
import { Vector2 } from "three/webgpu";
import type { TslNode } from "@kb/scene-gpu";
import { smoothstep } from "../scene/math";
import { fbm4 } from "./noise";

type F = TslNode<"float">;
type V2 = TslNode<"vec2">;

/** An ellipse in frame units (height 1, origin at the centre, y up). */
export interface Reach {
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
}

/** How far short of the frame's sides the art is gone (frame units). */
const MARGIN = 0.04;
/** How much of the reach the noise may eat, at most. */
const ERODE = 0.3;
/** Where the fade begins, as a share of the eroded reach. */
const SOLID = 0.4;

/** One axis of a reach: radius `wanted` about `centre`, in a frame `half` either side of 0. */
function fit(centre: number, wanted: number, half: number): readonly [number, number] {
  const most = Math.max(0.05, half - MARGIN);
  const r = Math.min(wanted, most);
  return [Math.min(most - r, Math.max(r - most, centre)), r];
}

/**
 * The reach about `centre` (frame units) for a frame `aspect` wide and 1
 * high: `wanted` radii, about a centre slid inward until they fit, and cut
 * only where the frame is smaller than they are.
 */
export function reachWithin(
  aspect: number,
  centre: { readonly x: number; readonly y: number },
  wanted: { readonly x: number; readonly y: number },
): Reach {
  const [x, rx] = fit(centre.x, wanted.x, aspect / 2);
  const [y, ry] = fit(centre.y, wanted.y, 0.5);
  return { x, y, rx, ry };
}

/** How much of a thing centred at `(x, y)` is kept: whole inside two thirds of the reach, gone past its rim. */
export const keptAt = (reach: Reach, x: number, y: number): number =>
  1 - smoothstep(0.65, 1.1, Math.hypot((x - reach.x) / reach.rx, (y - reach.y) / reach.ry));

/** A scene's reach as its shader reads it. */
export function dissolveUniforms() {
  const centre = uniform(new Vector2());
  const radius = uniform(new Vector2(1, 1));
  return {
    centre,
    radius,
    set: (reach: Reach) => {
      centre.value.set(reach.x, reach.y);
      radius.value.set(reach.rx, reach.ry);
    },
  };
}
export type DissolveUniforms = ReturnType<typeof dissolveUniforms>;

const dissolveFn = Fn(([q, drift]: readonly [V2, F]) => {
  const r = length(q);
  // Noise only eats in (0–1 times ERODE), so at r ≥ 1 nothing is left, whatever it does.
  const eaten = clamp(
    fbm4(q.mul(1.7).add(vec2(drift, drift.mul(-0.7))))
      .mul(1.6)
      .sub(0.3),
    0,
    1,
  );
  return float(1).sub(fade(SOLID, 1, r.mul(eaten.mul(ERODE).add(1))));
}).setLayout({
  name: "kbDissolve",
  type: "float",
  inputs: [
    { name: "q", type: "vec2" },
    { name: "drift", type: "float" },
  ],
});

/** How much of the art is left at `p` (frame units): 1 inside the reach, 0 at its eroded rim. */
export const dissolve = (u: DissolveUniforms, p: V2, drift: F): F =>
  dissolveFn(p.sub(u.centre).div(u.radius), drift);
