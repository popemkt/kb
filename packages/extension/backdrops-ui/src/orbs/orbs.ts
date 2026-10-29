/**
 * Gradient orbs, as the CPU holds them: two huge soft spheres filling the
 * frame, as the reference's fill its picture, and a small dim one far
 * behind them, each resting where the composition puts it and drifting
 * about that rest on Lissajous paths of its own (twenty to forty seconds
 * round), so the two great ones drift nearer and part, their radii
 * breathing. The first is nearest: the shader lays them back to front,
 * their soft edges and glows blending (`orbs-shader.ts`).
 *
 * Pure, so the layout and the drift are tested without a GPU.
 */
import type { Rng } from "../scene/rng";
import { TAU } from "../scene/math";

/** How many orbs the shader reads. */
export const ORBS = 3;

/** One orb: where it rests (shares of the composition's reach), its size, how lit it is, and how it drifts. */
export interface Orb {
  /** Rest, frame units from the composition's centre (y up), at full scale. */
  readonly x: number;
  readonly y: number;
  /** Radius, frame heights at full scale. */
  readonly r: number;
  /** 0 in the light's shadow, 1 fully lit. */
  readonly light: number;
  /** Drift reach (frame units), and its two periods (s) and phases. */
  readonly reach: number;
  readonly periods: readonly [number, number];
  readonly phases: readonly [number, number];
}

/**
 * The reference composition (the owner's picture), set whole into the
 * frame, since an orb is never cut by anything but its own soft edge: a
 * great orb right of centre, lit on its upper right limb; a second, two
 * thirds its size, high at the left, lit on its lower right; and a small
 * one in shadow far behind, between them. The seed varies each a little.
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
      x: jitter(0.28, 0.05),
      y: jitter(-0.03, 0.02),
      r: jitter(0.35, 0.015),
      light: 1,
      ...drift(0.06),
    },
    {
      x: jitter(-0.6, 0.05),
      y: jitter(0.1, 0.03),
      r: jitter(0.25, 0.015),
      light: 0.9,
      ...drift(0.09),
    },
    {
      x: jitter(-0.12, 0.05),
      y: jitter(0.22, 0.03),
      r: jitter(0.1, 0.01),
      light: 0.25,
      ...drift(0.1),
    },
  ];
}

/** Where the composition puts its centre, and how large the whole is. */
export interface OrbFrame {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

/** An orb placed at time `t` (s): centre and radius in frame units, and its light. */
export interface PlacedOrb {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly light: number;
}

/**
 * Every orb at `t`: drifted about its rest, its radius breathing by a few
 * percent and swelling by `swell` (the owner's writes, 0–1), set about the
 * composition at `frame`.
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
    const breathe = 1 + 0.05 * Math.sin((TAU * t) / (px * 0.4) + ay) + 0.05 * swell;
    return {
      x: frame.x + (orb.x + dx) * frame.scale,
      y: frame.y + (orb.y + dy) * frame.scale,
      r: orb.r * breathe * frame.scale,
      light: orb.light,
    };
  });
}
