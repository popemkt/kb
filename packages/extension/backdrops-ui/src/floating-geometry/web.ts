/**
 * Floating geometry's glass, as the CPU holds it: three sheets of low-poly
 * facets, each a lattice of jittered triangles that the shader solves per
 * pixel (`floating-geometry-shader.ts`). The near sheet is the glass piece
 * floating above the field: only its facets round the knots, each whole;
 * the two behind it are the web, every facet, part of the field, the
 * farther one larger and hazier, so the field has depth. What is
 * the seed's is here: each sheet's cell (how large its facets are), its
 * turn, where it lies, how crumpled it is and how far back, and the knots
 * where the glass gathers and the light with it, behind which the lamps
 * stand.
 *
 * Each sheet slides a little about its rest on a slow clock of its own and
 * against the eye's lean, the near one further (parallax); the shader folds
 * every vertex in depth on a clock of its own, so facets tilt into and out
 * of the light. Nothing travels far, so the composition the seed laid out
 * holds.
 *
 * Pure, so the layout and the motion are tested without a GPU.
 */
import type { Rng } from "../scene/rng";
import { TAU } from "../scene/math";

/** How many sheets the shader reads. */
export const SHEETS = 3;
/** How far a vertex strays from its lattice point (across the jitter's whole span), and how far it sways, shares of a cell. */
export const JITTER = 0.45;
export const SWAY = 0.04;

/** One sheet of the web, at full scale. */
export interface Sheet {
  /** A cell's side, frame units: a facet is about this large. */
  readonly cell: number;
  /** How its lattice is turned (radians). */
  readonly angle: number;
  /** Where its lattice's origin rests, frame units from the main knot: the near sheet's on it. */
  readonly offset: readonly [number, number];
  /** Which lattice it is: the shader hashes its vertices by this. */
  readonly seed: number;
  /** How far its vertices fold in depth, shares of a cell. */
  readonly crumple: number;
  /** 0 nearest to 1 farthest: a far sheet is dimmer and bluer, and slides less. */
  readonly depth: number;
  /** How far it slides about its rest (frame units), on what period (s), from what phase. */
  readonly drift: number;
  readonly period: number;
  readonly phase: number;
}

export interface WebLayout {
  /** The near sheet first. */
  readonly sheets: readonly Sheet[];
  /**
   * Where the glass and the light gather: x and y, frame units from the
   * main knot (the first, at the origin), and how far the piece reaches
   * round it, at full scale.
   */
  readonly knots: readonly (readonly [number, number, number])[];
}

/**
 * The seed's glass: a near sheet of large facets, and behind it a middle
 * one and a far one of larger facets, each turned against the others; the
 * main knot at the origin (the composition places it), where the light
 * gathers, and two either side of it, a little above at the right and a
 * little below at the left: one mass spread across the frame, wider than
 * tall, so it sits whole in the head's band as a title screen sets its hero
 * opposite its words.
 */
export function layoutWeb(rng: Rng): WebLayout {
  // The near sheet has a corner at the main knot, so the light gathers on one; the far one lies anywhere.
  const sheet = (cell: number, depth: number): Sheet => ({
    cell,
    angle: rng.range(-0.5, 0.5),
    offset: [rng.range(-0.5, 0.5) * cell * depth, rng.range(-0.5, 0.5) * cell * depth],
    seed: rng.range(10, 900),
    crumple: rng.range(0.55, 0.8),
    depth,
    drift: rng.range(0.02, 0.04) * (1 - 0.5 * depth),
    period: rng.range(30, 50),
    phase: rng.range(0, TAU),
  });
  const near = sheet(rng.range(0.24, 0.28), 0);
  const far = sheet(rng.range(0.5, 0.6), 1);
  const knots: WebLayout["knots"] = [
    [0, 0, rng.range(0.38, 0.42)],
    [rng.range(0.5, 0.58), rng.range(0.03, 0.08), rng.range(0.32, 0.36)],
    [rng.range(-0.56, -0.48), rng.range(-0.05, -0.01), rng.range(0.28, 0.32)],
  ];
  // The middle sheet is drawn last, so a seed's piece and far web are what they were without it.
  const middle = sheet(rng.range(0.34, 0.4), 0.5);
  return { sheets: [near, middle, far], knots };
}

/**
 * How far the piece stands past its knots' reach: a facet is the piece's
 * when its corners, strayed as they rest, lie within reach, so only the
 * sway takes one past it (shares of a cell); the near sheet's slide and the
 * eye's lean move it a little more (frame units).
 */
const OVERHANG = SWAY;
const SLIDE_ROOM = 0.06;

/** Where the piece can reach about its main knot at full scale: frame units, left and bottom negative. */
export interface PieceBounds {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export function pieceBounds({ sheets, knots }: WebLayout): PieceBounds {
  const over = OVERHANG * (sheets[0]?.cell ?? 0) + SLIDE_ROOM;
  const along = (pick: (k: readonly [number, number, number]) => number) => knots.map(pick);
  return {
    left: Math.min(...along(([x, , r]) => x - r)) - over,
    right: Math.max(...along(([x, , r]) => x + r)) + over,
    top: Math.max(...along(([, y, r]) => y + r)) + over,
    bottom: Math.min(...along(([, y, r]) => y - r)) - over,
  };
}

/** How far inside the frame's edges the piece keeps (frame units). */
export interface PieceMargin {
  readonly sides: number;
  readonly top: number;
  readonly bottom: number;
}

/**
 * Where the main knot stands and how large the piece is in a frame `aspect`
 * wide and 1 high (origin at its centre, y up): at `at` and `scale`, slid in
 * and then shrunk only as far as keeps every facet inside the frame by its
 * margins (frame units), so the whole cluster sits in the head's band.
 */
export function fitPiece(
  bounds: PieceBounds,
  at: { readonly x: number; readonly y: number; readonly scale: number },
  aspect: number,
  margin: PieceMargin,
): { readonly x: number; readonly y: number; readonly scale: number } {
  const half = Math.max(0.05, aspect / 2 - margin.sides);
  const tall = Math.max(0.05, 1 - margin.top - margin.bottom);
  const scale = Math.min(
    at.scale,
    (2 * half) / (bounds.right - bounds.left),
    tall / (bounds.top - bounds.bottom),
  );
  const x = Math.min(half - bounds.right * scale, Math.max(-half - bounds.left * scale, at.x));
  const y = Math.min(
    0.5 - margin.top - bounds.top * scale,
    Math.max(-0.5 + margin.bottom - bounds.bottom * scale, at.y),
  );
  return { x, y, scale };
}

/** Where the composition puts the main knot, how large the whole is, and how far the eye has moved off it. */
export interface WebFrame {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  /** The eye's offset (frame units): the near sheet slides against it, the far one barely. */
  readonly lean: readonly [number, number];
}

/** A sheet at `t`, as the shader reads it: its lattice's origin and cell in frame units, its turn, seed, fold and depth, and how far it has slid from its rest. */
export interface PlacedSheet {
  readonly slid: readonly [number, number];
  readonly x: number;
  readonly y: number;
  readonly cell: number;
  readonly angle: number;
  readonly seed: number;
  readonly crumple: number;
  readonly depth: number;
}

/** How far the near sheet slides for a unit of `lean`. */
const PARALLAX = 0.06;

/** Every sheet at time `t` (s): slid about its rest, against the eye, and set about the main knot at `frame`. */
export function placeSheets(sheets: readonly Sheet[], t: number, frame: WebFrame): PlacedSheet[] {
  return sheets.map((sheet) => {
    const turn = (TAU * t) / sheet.period + sheet.phase;
    const slide = (1 - 0.7 * sheet.depth) * PARALLAX;
    const x = sheet.offset[0] + sheet.drift * Math.sin(turn) - frame.lean[0] * slide;
    const y = sheet.offset[1] + sheet.drift * 0.7 * Math.cos(turn * 0.8) - frame.lean[1] * slide;
    return {
      slid: [(x - sheet.offset[0]) * frame.scale, (y - sheet.offset[1]) * frame.scale],
      x: frame.x + x * frame.scale,
      y: frame.y + y * frame.scale,
      cell: sheet.cell * frame.scale,
      angle: sheet.angle,
      seed: sheet.seed,
      crumple: sheet.crumple,
      depth: sheet.depth,
    };
  });
}
