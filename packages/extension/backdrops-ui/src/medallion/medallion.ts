/**
 * The wolf medallion, as the CPU holds it: kb's own sigil, never another
 * work's emblem. A round steel disk with a raised rim, and on it a
 * front-facing wolf mask cut in straight planes (pointed ears, a ruff in two
 * steps, a long closed muzzle), its eyes engraved slits. Around it turns a
 * faint circle of five glyphs, each kb's own evocation of one Sign by its
 * nature (a force pushed out, a flame, a ward, a shield, a mind turned),
 * drawn in a few straight strokes.
 *
 * Everything is in medallion units: the disk's radius is 1, y up. Pure, so
 * the geometry and the tremble are tested without a GPU.
 */

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

/** One glyph of the circle: what it evokes, and its strokes in a cell of radius 1. */
export interface Glyph {
  readonly evokes: "force" | "flame" | "ward" | "shield" | "mind";
  readonly strokes: readonly Stroke[];
}

/** The five glyphs, in their order round the circle. */
export const GLYPHS: readonly Glyph[] = [
  {
    // A force pushed out: a stem and two chevrons rising from it.
    evokes: "force",
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

/** The circle the glyphs stand on, and its two fine rings (medallion units). */
export const CIRCLE = { glyphs: 1.45, inner: 1.26, outer: 1.64, glyph: 0.15 } as const;
/** One turn of the circle (s). */
export const TURN_SECONDS = 240;

/** How the medallion trembles: its reach (medallion units) and how long it rings (s). */
const TREMBLE_REACH = 0.035;
const TREMBLE_RING = 0.9;

/**
 * Where the medallion stands `since` seconds after something happened,
 * startled by `strength` (0–1): a fast, uneven shiver about its rest,
 * dying away within a second. Nothing before, and nothing once it has rung.
 */
export function tremble(since: number, strength: number): Point {
  if (since < 0 || since > TREMBLE_RING * 4) return [0, 0];
  const reach =
    TREMBLE_REACH * strength * Math.exp(-since / TREMBLE_RING) * Math.min(1, since * 30);
  return [
    reach * 0.5 * (Math.sin(since * 61) + Math.sin(since * 97 + 1.3)),
    reach * 0.5 * (Math.sin(since * 73 + 0.7) + Math.sin(since * 109 + 2.1)),
  ];
}
