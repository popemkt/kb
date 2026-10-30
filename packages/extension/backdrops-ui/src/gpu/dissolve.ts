/**
 * How a GPU backdrop's art dissolves into the page by its own shape, never
 * by the frame's (DESIGN-UI.md → Page-head backdrops → GPU scenes): the
 * stage's feather fades along the frame's sides, and anything still there
 * when it begins reads as a box. So a scene's art keeps to a reach about its
 * composition, a rounded oblong (a superellipse: fuller than an ellipse for
 * art that fills the frame, so it keeps its corners; an ellipse for a glow)
 * that noise eats into, and is gone before any side.
 *
 * - `reachWithin` (CPU): the reach a scene asks for about its composition,
 *   slid toward the frame's centre as far as it must, and only then cut, so
 *   it clears every side by a margin. Noise only ever eats in, so the art is
 *   gone at its rim whatever the noise does. How much of it is whole
 *   (`solid`) is the scene's: a subject in the open keeps little of it, art
 *   that fills the frame as its picture does keeps most.
 * - `glowAbout` (CPU): the reach of a field lit by its subject (the air
 *   round a glass piece, the glow round an orb): an ellipse that stays
 *   centred on the subject and shrinks as a whole until it clears the
 *   frame's sides and bottom, so the field fades by its own round shape
 *   however near a side the subject stands, never by a band along the side.
 *   Its top may run on past the frame's, which lies under the app's bar.
 * - `dissolve` (GPU): per pixel, 1 inside, easing to 0 at a rim the noise
 *   eats into, so the edge is ragged and slow, never a line.
 * - `farField` (GPU): the far layer of a frame that spans the scroll region
 *   (distant shards, far orbs, plumes of smoke, sparks), whose shapes are
 *   seeded by where they stand, in heights, so a wider frame adds more of
 *   the same. A far shape is never cut by a reach: it fades whole by where
 *   its centre stands (`standing`), toward the frame's sides as far as the
 *   scene asks (none for a field that is full-bleed), toward its bottom and
 *   under the head's text, each a little sooner or later by its own draw,
 *   so the field thins out shape by shape and nothing marks a line.
 */
import { Fn, abs, clamp, float, pow, smoothstep as fade, uniform, vec2 } from "three/tsl";
import { Vector2 } from "three/webgpu";
import type { TslNode } from "@kb/scene-gpu";
import { fbm4 } from "./noise";
import type { textScrim } from "./text-scrim";

type F = TslNode<"float">;
type V2 = TslNode<"vec2">;

/** A superellipse in frame units (height 1, origin at the centre, y up), whole out to `solid` of its radii. */
export interface Reach {
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
  readonly solid: number;
  /** Its exponent: 2 a round glow; 3 fuller, so art that fills its frame keeps the corners. */
  readonly round: number;
}

/** How far short of the frame's sides the art is gone (frame units). */
const MARGIN = 0.04;
/** How much of the reach the noise may eat, at most. */
const ERODE = 0.3;
/** A reach's exponent where it fills a frame: 3 keeps the frame's corners and is still round; a glow is an ellipse, 2. */
const FILLING = 3;
const GLOW = 2;

/** One axis of a reach: radius `wanted` about `centre`, in a frame `half` either side of 0. */
function fit(centre: number, wanted: number, half: number): readonly [number, number] {
  const most = Math.max(0.05, half - MARGIN);
  const r = Math.min(wanted, most);
  return [Math.min(most - r, Math.max(r - most, centre)), r];
}

/**
 * The reach about `centre` (frame units) for a frame `aspect` wide and 1
 * high: `wanted` radii, about a centre slid inward until they fit, and cut
 * only where the frame is smaller than they are; whole out to `solid` of
 * them.
 */
export function reachWithin(
  aspect: number,
  centre: { readonly x: number; readonly y: number },
  wanted: { readonly x: number; readonly y: number },
  solid: number,
): Reach {
  const [x, rx] = fit(centre.x, wanted.x, aspect / 2);
  const [y, ry] = fit(centre.y, wanted.y, 0.5);
  return { x, y, rx, ry, solid, round: FILLING };
}

/** The least share of its wanted size a glow keeps, however near a side its subject stands. */
const LEAST = 0.1;

/**
 * The reach of a field lit by a subject at `centre` in a frame `aspect`
 * wide and 1 high: `wanted` radii about the subject, shrunk as a whole until
 * they clear the frame's sides and bottom (the top lies under the app's
 * bar); whole out to `solid` of them.
 */
export function glowAbout(
  aspect: number,
  centre: { readonly x: number; readonly y: number },
  wanted: { readonly x: number; readonly y: number },
  solid: number,
): Reach {
  const half = aspect / 2 - MARGIN;
  const fits = Math.min(
    1,
    (centre.x + half) / wanted.x,
    (half - centre.x) / wanted.x,
    (centre.y + 0.5 - MARGIN) / wanted.y,
  );
  const k = Math.max(LEAST, fits);
  return { x: centre.x, y: centre.y, rx: wanted.x * k, ry: wanted.y * k, solid, round: GLOW };
}

/** A scene's reach as its shader reads it. */
export function dissolveUniforms() {
  const centre = uniform(new Vector2());
  const radius = uniform(new Vector2(1, 1));
  const solid = uniform(0.4);
  const round = uniform(FILLING);
  return {
    centre,
    radius,
    solid,
    round,
    set: (reach: Reach) => {
      centre.value.set(reach.x, reach.y);
      radius.value.set(reach.rx, reach.ry);
      solid.value = reach.solid;
      round.value = reach.round;
    },
  };
}
export type DissolveUniforms = ReturnType<typeof dissolveUniforms>;

const dissolveFn = Fn(([q, drift, solid, round]: readonly [V2, F, F, F]) => {
  const r = pow(pow(abs(q.x), round).add(pow(abs(q.y), round)), float(1).div(round));
  // Noise only eats in (0–1 times ERODE), so at r ≥ 1 nothing is left, whatever it does.
  const eaten = clamp(
    fbm4(q.mul(1.7).add(vec2(drift, drift.mul(-0.7))))
      .mul(1.6)
      .sub(0.3),
    0,
    1,
  );
  return float(1).sub(fade(solid, 1, r.mul(eaten.mul(ERODE).add(1))));
}).setLayout({
  name: "kbDissolve",
  type: "float",
  inputs: [
    { name: "q", type: "vec2" },
    { name: "drift", type: "float" },
    { name: "solid", type: "float" },
    { name: "round", type: "float" },
  ],
});

/** How much of the art is left at `p` (frame units): 1 inside the reach, 0 at its eroded rim. */
export const dissolve = (u: DissolveUniforms, p: V2, drift: F): F =>
  dissolveFn(p.sub(u.centre).div(u.radius), drift, u.solid, u.round);

/**
 * Where a far layer's shapes thin out (frame units): over how much of the
 * frame's width in from each side (0, none: the field is full-bleed, and
 * the region's own edge is its edge), and between which heights, from the
 * frame's middle, a shape's centre fades toward the bottom.
 */
export interface FieldReach {
  readonly sides: number;
  readonly low: readonly [number, number];
}

/** How far a shape's own draw moves where it fades: shares of the span it fades over. */
const STAGGER = 0.6;
/** How much of a shape is left under the head's text. */
const UNDER_TEXT = 0.2;

/** A far layer across the frame: lay it out from the frame's aspect, read where each shape stands. */
export function farField(scrim: ReturnType<typeof textScrim>, reach: FieldReach) {
  /** Half the frame's width (frame units). */
  const half = uniform(1);
  return {
    layout: (aspect: number) => {
      half.value = aspect / 2;
    },
    /**
     * How much of a shape centred at `centre` (frame units) is shown, 0–1,
     * with `own` its draw (0–1): whole in the open, fading as its centre
     * nears a side (where the scene asks), the bottom, or the text.
     */
    standing: (centre: V2, own: F): F => {
      const shift = own.sub(0.5).mul(STAGGER);
      const down = fade(
        reach.low[0],
        reach.low[1],
        centre.y.add(shift.mul(reach.low[1] - reach.low[0])),
      );
      const across =
        reach.sides > 0
          ? fade(0, reach.sides, half.sub(abs(centre.x)).add(shift.mul(reach.sides)))
          : float(1);
      const at = vec2(centre.x.div(half.mul(2)).add(0.5), centre.y.add(0.5));
      return down.mul(across).mul(float(1).sub(scrim.under(at).mul(1 - UNDER_TEXT)));
    },
  };
}
export type FarField = ReturnType<typeof farField>;
