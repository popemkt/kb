/**
 * Floating geometry's lattice, as its shader solves it per pixel: each
 * sheet (`web.ts`) is a lattice of jittered triangles, every vertex strayed
 * by its own hash, swaying a little and folded in depth on a clock of its
 * own (`vertexFn`). The facet under a pixel is found among its cell's and
 * its neighbours' triangles (`facetAt`), with its three corners, their
 * lattice indices and how far the pixel lies from each edge; the facet
 * across an edge is named by its lattice corner (`cornerAcross`). Shared
 * corners and edges are solved the same from either side, so a sheet is
 * seamless, one web, never pieces.
 */
import { Fn, If, cos, float, floor, length, min, select, sin, vec2, vec3 } from "three/tsl";
import type { TslNode } from "@kb/scene-gpu";
import { hash, hash2 } from "../gpu/noise";
import { TAU } from "../scene/math";
import { JITTER, SWAY } from "./web";

type F = TslNode<"float">;
type V2 = TslNode<"vec2">;
type V3 = TslNode<"vec3">;
type V4 = TslNode<"vec4">;

/** A sheet as the shader reads it: its lattice's origin x y, cell and turn; then its seed, fold and depth. */
export interface SheetAt {
  readonly geo: V4;
  readonly look: V4;
}

/** Where lattice point `idx` rests, strayed by its own hash (lattice units): a vertex before it sways. */
const restingAt = (idx: V2, seed: F): V2 =>
  idx.add(
    hash2(idx.add(vec2(seed, seed.mul(0.37))))
      .sub(0.5)
      .mul(JITTER),
  );

/**
 * A lattice vertex: its point `idx` strayed by its own hash, swaying a
 * little, and folded in depth on a clock of its own (z in cells, signed).
 */
const vertexFn = Fn(([idx, seed, crumple, time]: readonly [V2, F, F, F]) => {
  const key = idx.add(vec2(seed, seed.mul(0.37)));
  const stray = hash2(key);
  const k = hash(key.add(17.3));
  const fold = hash(key.add(41.9));
  const clock = time.mul(TAU).div(k.mul(8).add(9)).add(k.mul(TAU));
  const sway = vec2(sin(clock.mul(0.7)), cos(clock.mul(0.9))).mul(SWAY / Math.SQRT2);
  const at = idx.add(stray.sub(0.5).mul(JITTER)).add(sway);
  return vec3(at, fold.sub(0.5).mul(2).add(sin(clock).mul(0.35)).mul(crumple));
}).setLayout({
  name: "kbWebVertex",
  type: "vec3",
  inputs: [
    { name: "idx", type: "vec2" },
    { name: "seed", type: "float" },
    { name: "crumple", type: "float" },
    { name: "time", type: "float" },
  ],
});

/** How far `p` lies inside the edge from `a` to `b` of a counter-clockwise triangle (negative outside). */
const edgeIn = (p: V2, a: V2, b: V2): F => {
  const e = b.sub(a);
  const pa = p.sub(a);
  return e.x.mul(pa.y).sub(e.y.mul(pa.x)).div(length(e).add(1e-6));
};

/** The facet of a sheet under `p`: its corners in frame units (z toward the eye), lattice indices, and edge distances. */
export interface Facet {
  readonly a: V3;
  readonly b: V3;
  readonly c: V3;
  readonly ia: V2;
  readonly ib: V2;
  readonly ic: V2;
  /** How far `p` is from edges AB, BC and CA, frame units. */
  readonly edges: V3;
  /** Where a lattice point (indices) rests in the frame, strayed as its vertex is before it sways (`restingAt`). */
  readonly frameOf: (idx: V2) => V2;
}

export function facetAt({ geo, look }: SheetAt, time: F, p: V2): Facet {
  const seed = look.x;
  const crumple = look.y;
  const co = cos(geo.w);
  const si = sin(geo.w);
  const d = p.sub(geo.xy);
  const l = vec2(co.mul(d.x).add(si.mul(d.y)), co.mul(d.y).sub(si.mul(d.x)))
    .div(geo.z)
    .toVar();
  // A vertex strays under half a cell, so the facet holding the pixel is in its own cell or the
  // neighbour on the side of the cell's middle it lies: four cells, whose corners are these nine.
  const base = floor(l.sub(0.5)).toVar();
  const corner: V3[][] = [];
  for (let i = 0; i < 3; i++) {
    const column: V3[] = [];
    for (let j = 0; j < 3; j++) {
      column.push(vertexFn(base.add(vec2(i, j)), seed, crumple, time).toVar());
    }
    corner.push(column);
  }
  const best = float(-1e9).toVar();
  const a = vec3(0).toVar();
  const b = vec3(0).toVar();
  const c = vec3(0).toVar();
  const ia = vec2(0).toVar();
  const ib = vec2(0).toVar();
  const ic = vec2(0).toVar();
  /** A triangle's corners, and the lattice cells they stand for. */
  const consider = ([pa, pb, pc]: readonly [V3, V3, V3], [ka, kb, kc]: readonly [V2, V2, V2]) => {
    const inside = min(
      min(edgeIn(l, pa.xy, pb.xy), edgeIn(l, pb.xy, pc.xy)),
      edgeIn(l, pc.xy, pa.xy),
    );
    If(inside.greaterThan(best), () => {
      best.assign(inside);
      a.assign(pa);
      b.assign(pb);
      c.assign(pc);
      ia.assign(ka);
      ib.assign(kb);
      ic.assign(kc);
    });
  };
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const at = (di: number, dj: number) => base.add(vec2(i + di, j + dj));
      const v00 = corner[i]?.[j];
      const v10 = corner[i + 1]?.[j];
      const v01 = corner[i]?.[j + 1];
      const v11 = corner[i + 1]?.[j + 1];
      if (v00 === undefined || v10 === undefined || v01 === undefined || v11 === undefined)
        continue;
      // Each cell splits along one diagonal or the other, by its own hash, so no grid shows.
      const rising = hash(at(0, 0).add(seed.add(31.7))).greaterThan(0.5);
      consider(
        [v00, v10, select(rising, v11, v01)],
        [at(0, 0), at(1, 0), select(rising, at(1, 1), at(0, 1))],
      );
      consider(
        [select(rising, v00, v10), v11, v01],
        [select(rising, at(0, 0), at(1, 0)), at(1, 1), at(0, 1)],
      );
    }
  }
  const toFrame = (v: V3): V3 =>
    vec3(
      geo.xy.add(vec2(co.mul(v.x).sub(si.mul(v.y)), si.mul(v.x).add(co.mul(v.y))).mul(geo.z)),
      v.z.mul(geo.z),
    );
  return {
    a: toFrame(a),
    b: toFrame(b),
    c: toFrame(c),
    ia,
    ib,
    ic,
    edges: vec3(edgeIn(l, a.xy, b.xy), edgeIn(l, b.xy, c.xy), edgeIn(l, c.xy, a.xy)).mul(geo.z),
    frameOf: (idx: V2) => toFrame(vec3(restingAt(idx, seed), 0)).xy,
  };
}

/** Whether a lattice cell splits along its rising diagonal: the same hash `facetAt` splits it by. */
const rising = (cell: V2, seed: F): TslNode<"bool"> =>
  hash(cell.add(seed.add(31.7))).greaterThan(0.5);

/**
 * The lattice corner of the facet across the edge from `ka` to `kb`, from
 * the facet whose third corner is `kc`: across a diagonal it is in the same
 * cell; across a side of the cell, in the next cell, by how that one splits.
 */
export function cornerAcross(ka: V2, kb: V2, kc: V2, seed: F): V2 {
  const d = kb.sub(ka);
  const lo = min(ka, kb);
  // A side along x: the facet is above it (the neighbour is in the cell below) or below it.
  const above = kc.y.greaterThan(lo.y);
  const below = select(above, lo.sub(vec2(0, 1)), lo);
  const flat = select(
    above,
    select(rising(below, seed), below, below.add(vec2(1, 0))),
    select(rising(below, seed), below.add(vec2(1, 1)), below.add(vec2(0, 1))),
  );
  // A side along y: the facet is right of it (the neighbour is in the cell to the left) or left.
  const right = kc.x.greaterThan(lo.x);
  const beside = select(right, lo.sub(vec2(1, 0)), lo);
  const upright = select(
    right,
    select(rising(beside, seed), beside, beside.add(vec2(0, 1))),
    select(rising(beside, seed), beside.add(vec2(1, 1)), beside.add(vec2(1, 0))),
  );
  const diagonal = d.x.abs().mul(d.y.abs()).greaterThan(0.5);
  return select(diagonal, ka.add(kb).sub(kc), select(d.y.abs().lessThan(0.5), flat, upright));
}
