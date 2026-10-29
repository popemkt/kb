/**
 * Light trails, as the CPU holds them: long-exposure streaks of light that
 * sweep across the head from the upper left down to the right in a gentle
 * S, after the owner's reference tile 09. Every strand is a curve in the
 * hero's own units (heights from the knot, at its scale), so a wider frame
 * shows more of each strand and never more or larger strands.
 *
 * - **The knot** is the hero: where the near strands gather and cross, a
 *   white-hot flare with gold and cyan strands through it. Away from it they
 *   fan out (`spread`), so the bundle opens toward both sides.
 * - **A strand** has a depth: a near one is a hairline, sharp and bright; a
 *   far one is wider, dimmer and out of focus; the farthest are the broad
 *   blue sheens of the field. One kind of thing at every depth, so the
 *   sheens are strands too.
 * - **Along its length** a strand comes and goes (`gap`), so it fades out by
 *   its own shape, and a packet of light runs along it now and then
 *   (`pulse`): the exposure's light still travelling.
 *
 * Pure, so the layout and the curve are tested without a GPU.
 */
import type { Rng } from "../scene/rng";
import { TAU } from "../scene/math";

/** How many strands the shader reads: near hairlines, mid strands and far sheens. */
export const STRANDS = 22;
const NEAR = 9;
const MID = 9;

/** The bundle's way across: falling to the right, and the S it bends in about the knot (hero units). */
export const SLOPE = -0.3;
export const BEND = -0.14;
export const KNEE = 1.1;
/** How quickly a strand leaves the knot for its fanned place: `spread` is 1 − exp(−u²·FAN). */
export const FAN = 0.55;

export interface Strand {
  /** Where it crosses the knot's column, above (+) or below it (hero units). */
  readonly offset: number;
  /** How far it fans away from the bundle, away from the knot (hero units, signed). */
  readonly fan: number;
  /** 0 cool (cyan and blue) to 1 warm (gold). */
  readonly warm: number;
  /** 0 nearest (a sharp hairline) to 1 farthest (a broad sheen of the field). */
  readonly depth: number;
  /** Its core's half-width (CSS pixels) when in focus, and how much light it carries. */
  readonly width: number;
  readonly light: number;
  /** Its slow sway: amplitude (hero units), frequency along it, phase, and speed (rad/s). */
  readonly wave: readonly [number, number, number, number];
  /** Where it comes and goes along its length: frequency and phase; and its pulse's phase. */
  readonly gap: readonly [number, number];
  readonly pulse: number;
}

/**
 * The reference's bundle: near strands through the knot, cyan and blue with
 * two or three gold; mid strands beside it, softer; and far sheens, broad and
 * dim, above and below. The seed varies each a little.
 */
export function layoutTrails(rng: Rng): readonly Strand[] {
  const sway = (amp: number): Strand["wave"] => [
    amp * rng.range(0.6, 1.2),
    rng.range(0.5, 1.4),
    rng.range(0, TAU),
    rng.range(0.03, 0.09) * (rng.chance(0.5) ? 1 : -1),
  ];
  const along = (): Pick<Strand, "gap" | "pulse"> => ({
    gap: [rng.range(0.35, 0.9), rng.range(0, TAU)],
    pulse: rng.range(0, TAU),
  });
  const strands: Strand[] = [];
  for (let i = 0; i < STRANDS; i++) {
    if (i < NEAR) {
      const side = (i / (NEAR - 1)) * 2 - 1;
      strands.push({
        offset: side * 0.035 + rng.range(-0.01, 0.01),
        fan: side * rng.range(0.18, 0.42),
        warm: i % 4 === 1 ? rng.range(0.85, 1) : rng.range(0, 0.25),
        depth: rng.range(0, 0.12),
        width: rng.range(0.55, 1.1),
        light: rng.range(0.45, 0.85),
        wave: sway(0.025),
        ...along(),
      });
    } else if (i < NEAR + MID) {
      const side = rng.chance(0.5) ? 1 : -1;
      strands.push({
        offset: side * rng.range(0.12, 0.42),
        fan: side * rng.range(0.1, 0.5),
        warm: rng.chance(0.2) ? rng.range(0.8, 1) : rng.range(0, 0.15),
        depth: rng.range(0.2, 0.45),
        width: rng.range(0.7, 1.2),
        light: rng.range(0.3, 0.55),
        wave: sway(0.04),
        ...along(),
      });
    } else {
      const side = i % 2 === 0 ? 1 : -1;
      strands.push({
        offset: side * rng.range(0.08, 0.38),
        fan: side * rng.range(0.15, 0.4),
        warm: rng.range(0, 0.15),
        depth: rng.range(0.85, 1),
        width: rng.range(1.2, 2),
        light: rng.range(0.12, 0.22),
        wave: sway(0.05),
        ...along(),
      });
    }
  }
  return strands;
}

/** How far a strand has fanned at `u` hero units from the knot: 0 at it, toward 1 far from it. */
export const spread = (u: number): number => 1 - Math.exp(-u * u * FAN);

/** The bundle's middle at `u` (hero units, y up). */
export const bundle = (u: number): number => SLOPE * u + BEND * Math.tanh(KNEE * u);

/** Where `strand` runs at `u` at time `t`: the bundle, its offset, its fan and its sway. */
export function strandAt(strand: Strand, u: number, t: number): number {
  const [amp, freq, phase, speed] = strand.wave;
  return (
    bundle(u) +
    strand.offset +
    strand.fan * spread(u) +
    amp * Math.sin(freq * u + phase + t * speed)
  );
}
