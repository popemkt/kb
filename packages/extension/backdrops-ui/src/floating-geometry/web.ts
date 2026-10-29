/**
 * Floating geometry's glass, as the CPU holds it: two sheets of low-poly
 * facets, each a lattice of jittered triangles that the shader solves per
 * pixel (`floating-geometry-shader.ts`). The near sheet is the glass piece
 * floating above the field: only its facets round the knots, each whole;
 * the far one is the web behind it, every facet, part of the field. What is
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
export const SHEETS = 2;

/** One sheet of the web, at full scale. */
export interface Sheet {
  /** A cell's side, frame units: a facet is about this large. */
  readonly cell: number;
  /** How its lattice is turned (radians). */
  readonly angle: number;
  /** Where its lattice's origin rests, frame units from the main knot. */
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
 * The seed's glass: a near sheet of large facets and a far one of smaller
 * facets turned against it; the main knot at the origin (the composition
 * places it), reaching furthest, one high at the left and one high at the
 * right, as the reference's light gathers in three places across its
 * picture.
 */
export function layoutWeb(rng: Rng): WebLayout {
  const sheet = (cell: number, depth: number): Sheet => ({
    cell,
    angle: rng.range(-0.5, 0.5),
    offset: [rng.range(-0.5, 0.5) * cell, rng.range(-0.5, 0.5) * cell],
    seed: rng.range(10, 900),
    crumple: rng.range(0.5, 0.75),
    depth,
    drift: rng.range(0.02, 0.04) * (1 - 0.5 * depth),
    period: rng.range(30, 50),
    phase: rng.range(0, TAU),
  });
  return {
    sheets: [sheet(rng.range(0.3, 0.36), 0), sheet(rng.range(0.42, 0.5), 1)],
    knots: [
      [0, 0, rng.range(0.3, 0.34)],
      [rng.range(-0.62, -0.5), rng.range(0.12, 0.2), rng.range(0.2, 0.24)],
      [rng.range(0.22, 0.32), rng.range(0.18, 0.26), rng.range(0.16, 0.2)],
    ],
  };
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
