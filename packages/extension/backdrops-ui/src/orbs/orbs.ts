/**
 * Gradient orbs, as the CPU holds them: two great spheres floating in front
 * of a deep blue field, and a dim one far behind them that belongs to the
 * field, each resting where the composition puts it and drifting about that
 * rest on Lissajous paths of its own (twenty to forty seconds round), so
 * the two great ones drift nearer and part, their radii breathing. Each
 * has a depth: the near ones slide further than the far one as the eye
 * leans (parallax), and the shader hazes and softens an orb by it
 * (`orbs-shader.ts`), back to front.
 *
 * Pure, so the layout and the drift are tested without a GPU.
 */
import type { Rng } from "../scene/rng";
import { TAU } from "../scene/math";

/** How many orbs the shader reads. */
export const ORBS = 3;

/** One orb: where it rests, its size, its light and depth, and how it drifts. */
export interface Orb {
  /** Rest, frame units from the composition's centre (y up), at full scale. */
  readonly x: number;
  readonly y: number;
  /** Radius, frame heights at full scale. */
  readonly r: number;
  /** 0 in the light's shadow, 1 fully lit. */
  readonly light: number;
  /** Which way its lit limb faces at rest (radians from +x, y up); the lamp leans it (`litToward`). */
  readonly facing: number;
  /** 0 nearest to 1 farthest: a far orb is hazier, softer and slides less; at 1 it is the field's. */
  readonly depth: number;
  /** How far its glow lights the field round it, past its limb (frame units, at full scale): the field is these glows. */
  readonly halo: number;
  /** Drift reach (frame units), and its two periods (s) and phases. */
  readonly reach: number;
  readonly periods: readonly [number, number];
  readonly phases: readonly [number, number];
}

/**
 * The reference composition (the owner's picture), as objects floating in
 * the frame: a great orb right of the title, half again as wide as the
 * frame is tall, cut by the frame's top and lit on its right; a second,
 * two thirds its size, high at the left above the title, only its lower
 * cap showing under the frame's top, lit on its lower right; and a dim one
 * in shadow far behind, between them. Both great ones stay clear of the
 * frame's bottom wherever they drift, so only the top (under the app's
 * bar) ever cuts them. The seed varies each a little, and where each faces.
 */
export function layoutOrbs(rng: Rng): readonly Orb[] {
  const jitter = (v: number, by: number) => v + rng.range(-by, by);
  const drift = (reach: number): Pick<Orb, "reach" | "periods" | "phases"> => ({
    reach,
    periods: [rng.range(20, 32), rng.range(26, 40)],
    phases: [rng.range(0, TAU), rng.range(0, TAU)],
  });
  return [
    {
      x: jitter(0.62, 0.03),
      y: jitter(0.41, 0.015),
      r: jitter(0.72, 0.015),
      light: 1,
      facing: jitter(Math.PI / 7, 0.1),
      depth: 0,
      halo: 0.55,
      ...drift(0.03),
    },
    {
      x: jitter(-0.84, 0.04),
      y: jitter(0.76, 0.02),
      r: jitter(0.5, 0.015),
      light: 0.85,
      facing: jitter(-Math.PI / 3, 0.12),
      depth: 0.4,
      halo: 0.45,
      ...drift(0.035),
    },
    {
      x: jitter(-0.12, 0.05),
      y: jitter(0.24, 0.03),
      r: jitter(0.5, 0.02),
      light: 0.25,
      facing: jitter(0, 0.3),
      depth: 1,
      halo: 0.65,
      ...drift(0.05),
    },
  ];
}

/** Where the composition puts its centre, how large the whole is, and how far the eye has moved off it. */
export interface OrbFrame {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  /** The eye's offset (frame units): a near orb slides against it, the far one barely. */
  readonly lean: readonly [number, number];
}

/** An orb placed at time `t` (s): centre, radius and glow in frame units, its light, facing and depth. */
export interface PlacedOrb {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly halo: number;
  readonly light: number;
  readonly facing: number;
  readonly depth: number;
}

/** How far the nearest orb slides for a unit of `lean`. */
const PARALLAX = 0.05;

/**
 * Every orb at `t`: drifted about its rest, its radius breathing by a few
 * percent and swelling by `swell` (the owner's writes, 0–1), slid against
 * the eye by its depth, set about the composition at `frame`.
 */
export function placeOrbs(
  orbs: readonly Orb[],
  t: number,
  frame: OrbFrame,
  swell: number,
): PlacedOrb[] {
  return orbs.map((orb) => {
    const [px, py] = orb.periods;
    const [ax, ay] = orb.phases;
    const dx = orb.reach * Math.sin((TAU * t) / px + ax);
    const dy = orb.reach * 0.7 * Math.sin((TAU * t) / py + ay);
    const breathe = 1 + 0.03 * Math.sin((TAU * t) / (px * 0.4) + ay) + 0.04 * swell;
    const slide = (1 - 0.8 * orb.depth) * PARALLAX;
    return {
      x: frame.x + (orb.x + dx) * frame.scale - frame.lean[0] * slide,
      y: frame.y + (orb.y + dy) * frame.scale - frame.lean[1] * slide,
      r: orb.r * breathe * frame.scale,
      halo: orb.halo * frame.scale,
      light: orb.light,
      facing: orb.facing,
      depth: orb.depth,
    };
  });
}

/** How far the lamp leans an orb's lit side from where it faces, against that facing's 1. */
const LEAN = 0.7;

/**
 * The way `orb`'s lit limb faces with the lamp at `lamp` (frame units), as
 * a unit vector: where the composition turns it, leaned toward the lamp.
 * One light could not light the reference's two orbs on the sides it does,
 * so each keeps its own and the lamp only swings it.
 */
export function litToward(
  orb: PlacedOrb,
  lamp: { readonly x: number; readonly y: number },
): readonly [number, number] {
  const dx = lamp.x - orb.x;
  const dy = lamp.y - orb.y;
  const far = Math.hypot(dx, dy) || 1;
  const x = Math.cos(orb.facing) + (LEAN * dx) / far;
  const y = Math.sin(orb.facing) + (LEAN * dy) / far;
  const length = Math.hypot(x, y) || 1;
  return [x / length, y / length];
}
