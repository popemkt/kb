/**
 * The medallion's chain, in three dimensions: oval links of round wire,
 * each a stadium (two straight runs joined by half circles) swept by the
 * wire, interlocking, every other one turned a quarter about the chain's
 * line, up from the bail past the frame's top.
 *
 * Each link is solved where the eye's ray meets it, analytically, for the
 * pixel: a face-on link is a stadium torus seen from the front (its depth
 * and normal from how far the pixel lies off the wire's centreline); an
 * edge-on one is its straight runs and the two half tori at its ends seen
 * from the side. Where two links cross, the nearer shows, the choice
 * softened over the pixel's footprint, so an interlock never stairs; where
 * one passes close by another's wire, it is shadowed (contact occlusion).
 * It is lit by the medallion's own metal model (`metal-shader.ts`),
 * brushed along its wire. The eyes' light never reaches it: the chain
 * leaves the bail far past their reach.
 */
import {
  abs,
  float,
  floor,
  fract,
  fwidth,
  length,
  max,
  mix,
  normalize,
  smoothstep,
  sqrt,
  step,
  vec2,
  vec3,
} from "three/tsl";
import type { TslNode } from "@kb/scene-gpu";
import { metalLit } from "./metal-shader";

type F = TslNode<"float">;
type V2 = TslNode<"vec2">;
type V3 = TslNode<"vec3">;

/**
 * The links (medallion units): how far apart they hang, half their
 * length and half their width (the wire's centreline), and the wire's
 * radius.
 */
const LINK = { pitch: 0.17, length: 0.11, width: 0.07, wire: 0.022 } as const;
/** The wire's half circles' radius and the straight run's half length, along the centreline. */
const BEND = LINK.width;
const RUN = LINK.length - LINK.width;
/** Iron (linear): the chain's reflectance, a little darker than the steel, and its wear. */
const IRON = vec3(0.4, 0.4, 0.42);
const IRON_WEAR = 0.2;

/** How far `(across, along)` lies from a stadium's centreline in its own plane (signed: past it is positive), and the way out from it. */
function offStadium(across: F, along: F) {
  const run = max(abs(along).sub(RUN), 0);
  const out = vec2(across, run.mul(along.sign()));
  const rho = length(out).max(1e-5);
  return { off: rho.sub(BEND), out: out.div(rho) };
}

/** A link at the pixel: how much of it covers the pixel, how near it is (z, toward the eye), its normal, its wire's way, its contact shadow. */
interface Link {
  readonly cover: F;
  readonly z: F;
  readonly normal: V3;
  readonly wire: V3;
  readonly shade: F;
}

/** A face-on link at `(x, v)` (v along the chain from the link's centre): a stadium torus seen from the front. */
function faceOn(x: F, v: F): Link {
  const { off, out } = offStadium(x, v);
  const r = LINK.wire;
  const sd = abs(off).sub(r);
  const w = fwidth(sd).max(1e-5);
  const z = sqrt(
    max(
      off
        .mul(off)
        .negate()
        .add(r * r),
      0,
    ),
  );
  const normal = normalize(vec3(out.mul(off), z));
  // Its neighbours are edge-on: their wire runs in the plane across this one, through its ends.
  const near = (shift: number): F => {
    const theirs = offStadium(z, v.sub(shift));
    return length(vec2(x, theirs.off));
  };
  const shade = smoothstep(r, r * 3.5, near(LINK.pitch).min(near(-LINK.pitch)));
  return {
    cover: smoothstep(w, w.negate(), sd),
    z,
    normal,
    wire: vec3(out.y.negate(), out.x, 0),
    shade,
  };
}

/** An edge-on link at `(x, v)`: its straight runs and the half tori at its ends, seen from the side. */
function edgeOn(x: F, v: F): Link {
  const r = LINK.wire;
  const s = sqrt(
    max(
      x
        .mul(x)
        .negate()
        .add(r * r),
      0,
    ),
  );
  const reach = s.add(BEND);
  const end = max(abs(v).sub(RUN), 0);
  const sd = max(abs(x).sub(r), end.sub(BEND + r));
  const w = fwidth(sd).max(1e-5);
  // The nearest of the wire on the ray: z from the centreline's circle of radius BEND + s at the end.
  const z = sqrt(max(reach.mul(reach).sub(end.mul(end)), 0));
  const rho = reach.max(1e-5);
  const normal = normalize(vec3(x, end.mul(v.sign()).mul(s).div(rho), z.mul(s).div(rho)));
  const wire = normalize(vec3(0, z.add(1e-5), end.mul(v.sign()).negate()));
  // Its neighbours are face-on: their wire runs in the face's plane, through this one's ends.
  const near = (shift: number): F => length(vec2(z, offStadium(x, v.sub(shift)).off));
  const shade = smoothstep(r, r * 3.5, near(LINK.pitch).min(near(-LINK.pitch)));
  return { cover: smoothstep(w, w.negate(), sd).mul(step(end, reach)), z, normal, wire, shade };
}

/** `front` over `back` where it is nearer, softened over the pixel's footprint. */
function over(back: Link, front: Link): Link {
  const gap = front.z.sub(back.z);
  const soft = fwidth(gap).max(1e-4);
  const shown = front.cover.mul(mix(float(1), smoothstep(soft.negate(), soft, gap), back.cover));
  return {
    cover: max(back.cover, front.cover),
    z: mix(back.z, front.z, shown),
    normal: normalize(mix(back.normal, front.normal, shown)),
    wire: normalize(mix(back.wire, front.wire, shown)),
    shade: mix(back.shade, front.shade, shown),
  };
}

/**
 * The chain at `q` (medallion units, swung) up from `bail`: how much of the
 * pixel it covers, and its light (the medallion's metal model), the
 * window's share of it, its glint and the smoke's rim on it.
 */
export function chainAt(q: V2, bail: F, time: F) {
  const y = q.y.sub(bail);
  const index = floor(y.div(LINK.pitch));
  // The pixel lies by link `index` and the nearer of its neighbours: one of the two faces the eye
  // (the even one) and the other is turned a quarter.
  const side = fract(y.div(LINK.pitch)).lessThan(0.5).select(index.sub(1), index.add(1));
  const even = fract(index.mul(0.5)).lessThan(0.25);
  const along = (k: F): F => y.sub(k.add(0.5).mul(LINK.pitch));
  const face = faceOn(q.x, along(even.select(index, side)));
  const edge = edgeOn(q.x, along(even.select(side, index)));
  const both = over(face, edge);
  const cover = both.cover.mul(step(0, y.add(0.02))).toVar();
  const metal = metalLit(
    {
      q,
      normal: both.normal,
      brushed: both.wire,
      albedo: IRON,
      grime: float(1).sub(both.shade).mul(0.6),
      worn: float(IRON_WEAR),
    },
    time,
  );
  return {
    cover,
    lit: metal.lit.mul(both.shade).toVar(),
    windowed: metal.windowed.mul(both.shade),
    glint: metal.glint,
    rim: metal.rim.mul(both.shade),
  };
}
