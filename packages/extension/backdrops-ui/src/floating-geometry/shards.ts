/**
 * Floating geometry's shards, as the CPU holds them: flat glass pieces in
 * three dimensions, each one or two triangles (a fold), set around a few
 * hubs where their tips meet, so light gathers where edges converge. Every
 * piece sways about its own axis and drifts a little, on clocks of its own;
 * nothing turns all the way round, so the composition the seed laid out
 * holds. Each frame they are projected into the frame's units (height 1,
 * origin at the centre, y up) for the shader (`floating-geometry-shader.ts`).
 *
 * Pure, so the layout and the projection are tested without a GPU.
 */
import type { Rng } from "../scene/rng";
import { TAU } from "../scene/math";

export type Vec3 = readonly [number, number, number];
type Tri = readonly [Vec3, Vec3, Vec3];

/** How many faces the shader reads: a layout fills at most this many. */
export const FACES = 16;

/** A piece of glass: its faces about its centre, how it sways and drifts, and how far back it is. */
export interface Piece {
  readonly faces: readonly Tri[];
  /** Its centre at rest, frame units; z toward the viewer. */
  readonly centre: Vec3;
  /** The unit axis it sways about, its swing (radians), period (s) and phase. */
  readonly axis: Vec3;
  readonly swing: number;
  readonly period: number;
  readonly phase: number;
  /** How far it drifts (frame units), and on what period (s). */
  readonly drift: number;
  readonly driftPeriod: number;
  /** 0 nearest to 1 farthest: the far ones are softer and dimmer. */
  readonly depth: number;
  /** Whether its two faces share an edge (a fold), whose crease then burns brightest. */
  readonly folded: boolean;
  /** How strongly each of its outer edges catches the light, 0.3–1: glass is never lit evenly. */
  readonly catches: readonly [number, number, number, number];
}

/** A face as the shader reads it: its corners on screen and how it is lit. */
export interface ProjectedFace {
  readonly a: readonly [number, number];
  readonly b: readonly [number, number];
  readonly c: readonly [number, number];
  readonly depth: number;
  /** 0–1: how squarely it faces the light behind it now. */
  readonly lit: number;
  /** Each edge's brightness, AB, BC, CA: a fold's crease is the brightest. */
  readonly edges: readonly [number, number, number];
}

/** How far the eye stands from the frame's plane: perspective, gently. */
const EYE = 3;

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
/** A triangle with `f` applied to each corner. */
const mapTri = (tri: Tri, f: (v: Vec3) => Vec3): Tri => [f(tri[0]), f(tri[1]), f(tri[2])];
const unit = (a: Vec3): Vec3 => scale(a, 1 / Math.max(1e-9, Math.hypot(a[0], a[1], a[2])));

/** `v` turned by `angle` about the unit `axis` (Rodrigues). */
export function rotate(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)));
}

/** A point on a ray from `hub` at `angle`, `reach` away, at height `z`. */
const spoke = (hub: Vec3, angle: number, reach: number, z: number): Vec3 => [
  hub[0] + Math.cos(angle) * reach,
  hub[1] + Math.sin(angle) * reach,
  z,
];

/**
 * The seed's pieces: a main knot at the origin (the composition places it)
 * and three lesser ones off it, each a fan of shards whose tips nearly meet
 * at it. Coordinates are relative to the main knot, at full scale.
 */
export interface ShardLayout {
  readonly pieces: readonly Piece[];
  /** Where the shards' tips meet, the main knot first (at the origin). */
  readonly knots: readonly Vec3[];
}

export function layoutShards(rng: Rng): ShardLayout {
  // Each knot: where it is, how many shards meet there, how far they reach, and how far back they stand.
  const hubs: { at: Vec3; pieces: number; reach: number; depth: readonly [number, number] }[] = [
    { at: [0, 0, 0], pieces: 3, reach: 1.0, depth: [0, 0.3] },
    {
      at: [rng.range(-0.62, -0.46), rng.range(0.22, 0.34), -0.12],
      pieces: 2,
      reach: 0.7,
      depth: [0.35, 0.65],
    },
    {
      at: [rng.range(0.4, 0.56), rng.range(0.26, 0.38), -0.08],
      pieces: 2,
      reach: 0.62,
      depth: [0.25, 0.55],
    },
    {
      at: [rng.range(-0.2, 0.05), rng.range(-0.5, -0.38), -0.25],
      pieces: 1,
      reach: 0.9,
      depth: [0.7, 1],
    },
  ];
  const pieces: Piece[] = [];
  let faces = 0;
  for (const hub of hubs) {
    const start = rng.range(0, TAU);
    for (let k = 0; k < hub.pieces; k++) {
      const folded = faces + 2 <= FACES && rng.chance(0.7);
      const around = start + (k / hub.pieces) * TAU + rng.range(-0.6, 0.6);
      const span = rng.range(0.45, 0.95);
      const reach = hub.reach * rng.range(0.7, 1.15);
      // The tip sits just off the knot, so a knot is a cluster of near-meeting edges, not one point.
      const tip = spoke(hub.at, rng.range(0, TAU), rng.range(0.01, 0.06), rng.range(-0.05, 0.05));
      const left = spoke(hub.at, around - span / 2, reach, rng.range(-0.3, 0.3));
      const right = spoke(
        hub.at,
        around + span / 2,
        reach * rng.range(0.5, 1),
        rng.range(-0.3, 0.3),
      );
      const tris: Tri[] = [[tip, left, right]];
      if (folded) {
        // The second face shares the edge tip–right, folded back out of the plane.
        const beyond = spoke(
          hub.at,
          around + span * rng.range(0.9, 1.5),
          reach * rng.range(0.45, 0.85),
          rng.range(-0.4, 0.1),
        );
        tris.push([tip, right, beyond]);
      }
      const centre = scale(
        tris.flat().reduce((sum, v) => add(sum, v), [0, 0, 0] as Vec3),
        1 / (tris.length * 3),
      );
      pieces.push({
        faces: tris.map((tri) => mapTri(tri, (v) => sub(v, centre))),
        centre,
        axis: unit([rng.range(-1, 1), rng.range(-1, 1), rng.range(-0.4, 0.4)]),
        swing: rng.range(0.1, 0.24),
        period: rng.range(26, 48),
        phase: rng.range(0, TAU),
        drift: rng.range(0.008, 0.022),
        driftPeriod: rng.range(30, 60),
        depth: rng.range(hub.depth[0], hub.depth[1]),
        folded,
        catches: [rng.range(0.3, 1), rng.range(0.3, 1), rng.range(0.3, 1), rng.range(0.3, 1)],
      });
      faces += tris.length;
    }
  }
  return { pieces, knots: hubs.map((hub) => hub.at) };
}

/** Where the composition puts the main hub, and how large the whole is. */
export interface ShardFrame {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

/**
 * Every face at time `t` (s): each piece swung and drifted, scaled and set
 * about the hub at `frame`, seen in perspective, lit by how squarely it
 * faces `light` (frame units, behind the glass). Always `FACES` long:
 * spare faces are empty (zero area), which the shader draws as nothing.
 */
export function projectShards(
  pieces: readonly Piece[],
  t: number,
  frame: ShardFrame,
  light: readonly [number, number],
  swirl: number,
): ProjectedFace[] {
  const out: ProjectedFace[] = [];
  const lamp: Vec3 = [light[0], light[1], -0.8];
  for (const piece of pieces) {
    const angle =
      piece.swing * Math.sin((TAU * t) / piece.period + piece.phase) + swirl * piece.swing;
    const wander = (TAU * t) / piece.driftPeriod + piece.phase;
    const centre = add(piece.centre, [
      piece.drift * Math.sin(wander),
      piece.drift * Math.cos(wander * 0.8),
      0,
    ]);
    const place = (v: Vec3): Vec3 => {
      const at = add(centre, rotate(v, piece.axis, angle));
      return [frame.x + at[0] * frame.scale, frame.y + at[1] * frame.scale, at[2] * frame.scale];
    };
    const see = (v: Vec3): [number, number] => {
      const k = EYE / (EYE - v[2]);
      return [frame.x + (v[0] - frame.x) * k, frame.y + (v[1] - frame.y) * k];
    };
    piece.faces.forEach((face, i) => {
      const [a, b, c] = mapTri(face, place);
      const normal = unit(cross(sub(b, a), sub(c, a)));
      const mid = scale(add(add(a, b), c), 1 / 3);
      const toLamp = unit(sub(lamp, mid));
      const lit = Math.pow(Math.abs(dot(normal, toLamp)), 3);
      // The crease a fold shares (the first face's BC is the second's AB) burns brightest.
      const [ab, ca, bc, cd] = piece.catches;
      const crease = piece.folded ? 1.3 : bc;
      const edges: [number, number, number] = i === 0 ? [ab, crease, ca] : [crease, cd, ca * 0.6];
      out.push({ a: see(a), b: see(b), c: see(c), depth: piece.depth, lit, edges });
    });
  }
  while (out.length < FACES) {
    out.push({ a: [0, 0], b: [0, 0], c: [0, 0], depth: 1, lit: 0, edges: [0, 0, 0] });
  }
  return out.slice(0, FACES);
}
