/**
 * The wolf medallion, as the CPU holds it: kb's own sigil, never another
 * work's emblem. A round steel disk with a raised rim, and on it a
 * front-facing wolf mask cut in straight planes (pointed ears, a ruff in two
 * steps, a long closed muzzle), its eyes engraved slits. Around it turns a
 * faint circle of five glyphs, each kb's own evocation of one Sign by its
 * nature (a force pushed out, a flame, a ward, a shield, a mind turned),
 * drawn in a few straight strokes, each in a faint colour of that nature.
 * They are the backdrop's own glyph art (`RUNES`), the same contract an
 * owner's glyphs meet (`BackdropGlyph`).
 *
 * Everything is in medallion units: the disk's radius is 1, y up. Pure, so
 * the geometry and the swing are tested without a GPU.
 */

import type { BackdropGlyph } from "@kb/model";

export type Point = readonly [number, number];
/** One straight stroke: from, to. */
export type Stroke = readonly [Point, Point];

/** One half of the mask's outline, from the forehead's centre clockwise to the muzzle's tip. */
const MASK_HALF: readonly Point[] = [
  [0, 0.3],
  [0.2, 0.4],
  [0.37, 0.74],
  [0.5, 0.3],
  [0.64, 0.06],
  [0.48, -0.06],
  [0.56, -0.3],
  [0.3, -0.42],
  [0.15, -0.72],
  [0, -0.8],
];

const mirror = ([x, y]: Point): Point => [-x, y];

/** The mask's outline, a closed polygon: the right half, then the left back up. */
export const MASK: readonly Point[] = [
  ...MASK_HALF,
  ...MASK_HALF.slice(1, -1).toReversed().map(mirror),
];

/** Both sides of a stroke drawn on the right half. */
const both = (stroke: Stroke): Stroke[] => [stroke, [mirror(stroke[0]), mirror(stroke[1])]];

/** The eyes: slits slanting up and out, where the medallion's light shows. */
export const EYES: readonly Stroke[] = both([
  [0.11, 0.02],
  [0.3, 0.11],
]);

/** The engraving: brows over the eyes, the muzzle's ridge, the nose, and the ruff's folds. */
export const ENGRAVING: readonly Stroke[] = [
  ...both([
    [0.07, 0.15],
    [0.32, 0.25],
  ]),
  [
    [0, 0.2],
    [0, -0.5],
  ],
  ...both([
    [0, -0.6],
    [0.08, -0.52],
  ]),
  ...both([
    [0.42, -0.08],
    [0.3, -0.26],
  ]),
  ...both([
    [0.3, 0.42],
    [0.4, 0.2],
  ]),
];

/**
 * One glyph of the circle: what it evokes, its colour (`#rrggbb`), and its
 * strokes in a cell of radius 1. The colours are by nature, muted so each
 * reads as a faint emissive: a force a pale cold blue, a flame ember, a ward
 * violet, a shield amber, a mind a soft green.
 */
export interface Glyph {
  readonly evokes: "force" | "flame" | "ward" | "shield" | "mind";
  readonly color: string;
  readonly strokes: readonly Stroke[];
}

/** The five glyphs, in their order round the circle. */
export const GLYPHS: readonly Glyph[] = [
  {
    // A force pushed out: a stem and two chevrons rising from it.
    evokes: "force",
    color: "#8fbfe8",
    strokes: [
      [
        [0, -0.7],
        [0, 0.2],
      ],
      [
        [-0.45, 0.05],
        [0, 0.45],
      ],
      [
        [0, 0.45],
        [0.45, 0.05],
      ],
      [
        [-0.45, 0.35],
        [0, 0.75],
      ],
      [
        [0, 0.75],
        [0.45, 0.35],
      ],
    ],
  },
  {
    // A flame: a tall narrow lozenge, and the wick through it.
    evokes: "flame",
    color: "#f07a3c",
    strokes: [
      [
        [0, -0.7],
        [0.32, 0],
      ],
      [
        [0.32, 0],
        [0, 0.75],
      ],
      [
        [0, 0.75],
        [-0.32, 0],
      ],
      [
        [-0.32, 0],
        [0, -0.7],
      ],
      [
        [0, -0.35],
        [0, 0.3],
      ],
    ],
  },
  {
    // A ward: a gate, two bars held apart by a post, barred across.
    evokes: "ward",
    color: "#a48ce0",
    strokes: [
      [
        [-0.55, 0.6],
        [0.55, 0.6],
      ],
      [
        [-0.55, -0.6],
        [0.55, -0.6],
      ],
      [
        [0, -0.6],
        [0, 0.6],
      ],
      [
        [-0.32, 0],
        [0.32, 0],
      ],
    ],
  },
  {
    // A shield: a heater shield's outline, a spine down it.
    evokes: "shield",
    color: "#e3b45a",
    strokes: [
      [
        [-0.5, 0.6],
        [0.5, 0.6],
      ],
      [
        [0.5, 0.6],
        [0.5, 0],
      ],
      [
        [0.5, 0],
        [0, -0.72],
      ],
      [
        [0, -0.72],
        [-0.5, 0],
      ],
      [
        [-0.5, 0],
        [-0.5, 0.6],
      ],
      [
        [0, 0.42],
        [0, -0.38],
      ],
    ],
  },
  {
    // A mind turned: two hooks turned about each other.
    evokes: "mind",
    color: "#86c99a",
    strokes: [
      [
        [-0.5, -0.5],
        [0.5, 0.5],
      ],
      [
        [0.5, 0.5],
        [0.5, 0],
      ],
      [
        [-0.5, -0.5],
        [-0.5, 0],
      ],
      [
        [-0.5, 0.5],
        [-0.15, 0.15],
      ],
      [
        [0.15, -0.15],
        [0.5, -0.5],
      ],
    ],
  },
];

/** How wide a rune's strokes are, in its cell's radii. */
const RUNE_STROKE = 0.13;

/** A glyph's strokes as path data in the view box [-1, -1, 2, 2], y down as SVG's is. */
const pathOf = (strokes: readonly Stroke[]): string =>
  strokes.map(([[ax, ay], [bx, by]]) => `M ${ax} ${-ay} L ${bx} ${-by}`).join(" ");

/** kb's runes as the backdrop's own glyph art: what an art setting's glyphs replace. */
export const RUNES: readonly BackdropGlyph[] = GLYPHS.map((glyph) => ({
  name: glyph.evokes,
  color: glyph.color,
  shape: { kind: "path", d: pathOf(glyph.strokes), viewBox: [-1, -1, 2, 2], stroke: RUNE_STROKE },
}));

/** The circle the glyphs stand on, and its two fine rings (medallion units). */
export const CIRCLE = { glyphs: 1.4, inner: 1.22, outer: 1.56, glyph: 0.15 } as const;
/** One turn of the circle (s). */
export const TURN_SECONDS = 120;

/**
 * How the medallion hangs: a pendulum on its chain, slow (its period, s),
 * damped (the share of its critical damping), stirred by the air into a
 * sway this small (rad, its steady swing at rest), and pushed this hard
 * (rad/s) when something happens on the page.
 */
export const HANGING = { period: 7.5, damping: 0.05, sway: 0.02, push: 0.03 } as const;

/** A pendulum's state: how far it has swung from hanging straight (rad), and how fast it is swinging (rad/s). */
export interface Swing {
  readonly angle: number;
  readonly speed: number;
}

/**
 * The air on the medallion at `time` (s): two slow breaths near its own
 * swing, out of step, so its sway drifts and never repeats in a way the eye
 * can follow. As a torque, scaled so the damped pendulum's steady swing
 * peaks at about `HANGING.sway` (`AIR_GAIN`, its response to breaths just
 * off its own swing).
 */
const AIR_GAIN = 2.2;
function airOn(time: number): number {
  const w = (2 * Math.PI) / HANGING.period;
  const breath = Math.sin(time * w * 0.93) + 0.6 * Math.sin(time * w * 1.08 + 1.7);
  return breath * AIR_GAIN * HANGING.sway * HANGING.damping * w * w;
}

/**
 * The medallion's swing `dt` seconds on from `swing` at `time`, `pushed`
 * (0–1) by something happening now: a damped pendulum driven by the air,
 * stepped semi-implicitly so it stays stable at any frame rate.
 */
export function swingOn(swing: Swing, dt: number, time: number, pushed: number): Swing {
  const w = (2 * Math.PI) / HANGING.period;
  const step = Math.min(dt, 0.1);
  const torque = airOn(time) - w * w * swing.angle - 2 * HANGING.damping * w * swing.speed;
  const speed = swing.speed + torque * step + pushed * HANGING.push;
  return { angle: swing.angle + speed * step, speed };
}
