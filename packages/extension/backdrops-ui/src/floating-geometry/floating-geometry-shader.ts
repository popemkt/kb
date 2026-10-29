/**
 * Floating geometry's shaders (T1): a crumpled piece of low-poly glass in
 * front of deep navy air and a hazed web of glass behind it, gold light
 * gathering where facets meet.
 *
 * - **The web** is three sheets (`web.ts`), each a lattice of jittered
 *   triangles solved per pixel: the pixel's cell and its neighbours' are
 *   tried, and the triangle that holds it is the facet it sees, with its
 *   three corners and how far it lies from each edge. Every vertex folds in
 *   depth on a clock of its own (`vertex`), so each facet has a normal and
 *   tilts into and out of the light. Shared corners and edges are solved the
 *   same from either side, so the web is seamless, one sheet, never pieces.
 *   The sheets behind the piece have larger facets, turned against the
 *   near one's, hazed, softer the farther and barely warmed by the lamps,
 *   so they overlap and their seams cross.
 * - **The light** stands behind the glass: three lamps (`lamps`), the main
 *   one on a corner at the main knot, the others quiet. A corner's heat is
 *   the lamps near it, squared, so one point burns: a warm-white core in a
 *   long amber bloom. Light runs along each crease from a hot corner and
 *   dies out (`FLOW`), a fine stroke with a soft spill into both facets, so
 *   most seams fall to a hair of steel; a hot corner pours a fan of light
 *   into each facet that meets there, hugging the seams that leave it, as
 *   much as the facet passes of the lamp (transmission). A facet's body is
 *   slate glass lit by its turn to the key, so the crumple reads.
 * - **A band of light sweeps across** (`sweep`): the piece's seams glint
 *   as it passes, gold on a dark page and apricot on a light one.
 * - **The field** is its own pass (`fieldFragment`), drawn at a share of
 *   the frame's pixels, so it is cheap however wide the frame and as out of
 *   focus as a far layer: navy air lit by the lamps and the piece, falling
 *   away from them by its own light within its reach about the piece; a
 *   haze across the whole frame, dimmer away from the piece in heights, its
 *   lower edge its smoke's folds; and the two sheets behind, every facet,
 *   in broad slow pools of light (`poolAt`). Each of their panes, seams and
 *   corners fades whole by where it stands (`farField`), so the web thins
 *   out shape by shape toward the frame's sides, its bottom and the text.
 *   The piece (`pieceFragment`) is the other pass, in front: it hides some
 *   of the field and casts a shadow on it, and never fades.
 * - **Dark** pages show the light over the navy field on the page's own
 *   ground. **Light** pages show the glass as an engraving on the paper: a
 *   periwinkle wash, each facet a pale frost deeper as it turns from the
 *   key and peach where light passes it, its seams fine periwinkle ink
 *   turning apricot where light runs, the hot point an apricot bloom. It is
 *   composed in the page's own terms (`Grounds`).
 * - **The frame** lays the piece over the field and keeps the field quiet
 *   under the head's text (`textScrim`), never the piece.
 */
import {
  Fn,
  If,
  clamp,
  cos,
  cross,
  dot,
  exp,
  float,
  floor,
  length,
  min,
  mix,
  normalize,
  screenSize,
  screenUV,
  select,
  sin,
  smoothstep,
  step,
  uniform,
  uniformArray,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { Matrix3, Vector4 } from "three/webgpu";
import type { PictureSampler, TslNode } from "@kb/scene-gpu";
import type { Grounds } from "../gpu/gpu-scene";
import { dissolve, dissolveUniforms, type FarField } from "../gpu/dissolve";
import { gnoise, hash, hash2 } from "../gpu/noise";
import type { textScrim } from "../gpu/text-scrim";
import { TAU } from "../scene/math";
import { JITTER, SHEETS, SWAY } from "./web";

type F = TslNode<"float">;
type V2 = TslNode<"vec2">;
type V3 = TslNode<"vec3">;

/** The light (linear): a hot core, gold seams and pour, amber round the cores. */
const WHITE_HOT = vec3(1.0, 0.86, 0.62);
const GOLD = vec3(1.0, 0.6, 0.24);
const AMBER = vec3(1.0, 0.4, 0.1);
/** The glass where the light misses it: blue panes, steel seams. */
const PANE = vec3(0.3, 0.46, 1.0);
const STEEL = vec3(0.22, 0.34, 0.8);
/** The dark field: navy, deeper low and at the sides. */
const NAVY = vec3(0.009, 0.019, 0.07);
const NAVY_DEEP = vec3(0.003, 0.006, 0.024);
/** How many lamps stand behind the glass: the main one, and one behind each of the next two knots. */
const LAMPS = 3;
/** How far a lamp's heat reaches a vertex, frame units at full scale. */
const HEAT_REACH = 0.15;
/** How much less of the lamps' heat a sheet behind the piece takes, by its depth (then squared, so the middle one takes a third). */
const LAMPS_BEHIND = 0.85;
/** How far behind the glass the lamps stand (frame units), so a facet's tilt decides how much of them it passes. */
const LAMP_DEPTH = 0.35;
/** Where the glass piece ends: how far inside it a facet's cell must rest (`pieceAt`). */
const PIECE = 0.36;
/** Where the piece's shadow falls on the field, frame units at full scale: below, away from the main lamp. */
const SHADOW_FALL = vec2(0.03, 0.07);
/** The cool light along the piece's edge, lit from behind. */
const BACKLIT = vec3(0.45, 0.6, 1.0);
/** A light page's inks: periwinkle seams warming to apricot at a lamp, frost panes cool or peach, the lamps' warmth. */
const PERIWINKLE = vec3(0.5, 0.56, 0.9);
const APRICOT = vec3(0.98, 0.56, 0.36);
const FROST = vec3(0.84, 0.87, 0.99);
const PEACH = vec3(1.0, 0.82, 0.68);
const SUNLIT = vec3(1.0, 0.9, 0.78);
const LILAC_SHADE = vec3(0.86, 0.86, 0.97);
/** A light page's field: the navy's own wash, a breath of periwinkle on the paper. */
const WASH = vec3(0.935, 0.945, 0.99);
/** The air the far sheet is half lost in: a grey blue. */
const HAZE = vec3(0.5, 0.6, 0.9);
/** How far light runs along a crease from a hot corner before it dies out, frame units at full scale. */
const FLOW = 0.13;
/**
 * The haze across the frame: how fast it dims away from the piece (shares
 * of the scale), its level against the lit air's, between which heights
 * its lower edge folds away, and how much of the paper's wash it is.
 */
const HAZE_FALL = 2.2;
const HAZE_LEVEL = 0.35;
const HAZE_LOW = [-0.38, 0.28] as const;
const HAZE_PAPER = 0.35;
/** How broad the patches of light in the far web are: one about every 1/`POOL` heights. */
const POOL = 0.6;
/** The key's way, up at the right and toward the eye: a facet facing it is the lighter slate. */
const KEY = vec3(0.45, 0.5, 0.74);

/** The way the sweep travels (unit; the scene's `SWEEP_DIR`), and how wide its band is. */
const SWEEP = vec2(0.894, -0.447);
const BAND = 0.11;

const vectors = (n: number) => Array.from({ length: n }, () => new Vector4());

/**
 * Everything the CPU sets. Per sheet: `sheets[2n]` its lattice's origin
 * x y, its cell and its turn (frame units, radians); `sheets[2n+1]` its
 * seed, fold and depth. Per lamp: x y (frame units) and strength.
 */
export function glassUniforms(field: FarField) {
  /** The per-sheet values the CPU writes; the array below reads these very objects. */
  const sheet = vectors(SHEETS * 2);
  const lamp = vectors(LAMPS);
  const knot = vectors(LAMPS);
  return {
    sheet,
    lamp,
    knot,
    dark: uniform(1),
    time: uniform(0),
    /** This load's few degrees of hue: the light turned about grey (`hueTurn`). */
    hue: uniform(new Matrix3()),
    sheets: uniformArray<"vec4">(sheet, "vec4"),
    lamps: uniformArray<"vec4">(lamp, "vec4"),
    /** Where the glass piece gathers: each knot x y (frame units, moving with the near sheet) and its reach (shares of the scale). */
    knots: uniformArray<"vec4">(knot, "vec4"),
    /** How bright the lamps are: 1 at rest, swelling with the owner's writes. */
    heat: uniform(1),
    /** Where the sweeping band of light is, along `SWEEP` (frame units from the centre). */
    sweep: uniform(-9),
    /** How large the composition is: the lamps' reach scales with it. */
    scale: uniform(1),
    /** The frame the glass pass covers: x0, y0, x1, y1. */
    window: uniform(new Vector4(-1, -0.5, 1, 0.5)),
    /** One texel of the glass pass and of the field's, frame units: the width a seam is drawn over. */
    pixel: uniform(0.001),
    fieldPixel: uniform(0.004),
    /** The reach the air the lamps light about the piece dissolves within. */
    reach: dissolveUniforms(),
    /** Where the far web's facets stand across the frame, each fading whole. */
    field,
  };
}
export type GlassUniforms = ReturnType<typeof glassUniforms>;

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

/** The facet of sheet `n` under `p`: its corners in frame units (z toward the eye), lattice indices, and edge distances. */
interface Facet {
  readonly a: V3;
  readonly b: V3;
  readonly c: V3;
  readonly ia: V2;
  readonly ib: V2;
  readonly ic: V2;
  /** How far `p` is from edges AB, BC and CA, frame units. */
  readonly edges: V3;
  /** Where a lattice point (indices, unstrayed) lies in the frame. */
  readonly frameOf: (idx: V2) => V2;
}

function facetAt(u: GlassUniforms, n: number, p: V2): Facet {
  const geo = u.sheets.element(n * 2);
  const look = u.sheets.element(n * 2 + 1);
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
      column.push(vertexFn(base.add(vec2(i, j)), seed, crumple, u.time).toVar());
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
    frameOf: (idx: V2) => toFrame(vec3(idx, 0)).xy,
  };
}

/** What the sheets sum into: the light (dark), what is left of the paper (light), and how much of the field the piece hides. */
interface Sums {
  readonly light: V3;
  readonly paper: V3;
  readonly cover: F;
}

/** What a sheet's shading reads of the pixel: where it is, its pass's texel, the lamps' warmth there, the sweep, and how much of the lit air is left. */
interface Pixel {
  readonly p: V2;
  readonly texel: F;
  readonly warmth: F;
  readonly band: F;
  readonly left: F;
}

/**
 * How hot a vertex at `v` is: the lamps near it, each by its strength,
 * squared, so the main lamp's corner burns and a quiet lamp's barely warms.
 */
function heatAt(u: GlassUniforms, v: V2): F {
  let heat: F = float(0);
  const reach = u.scale.mul(HEAT_REACH);
  for (let k = 0; k < LAMPS; k++) {
    const lamp = u.lamps.element(k);
    const to = v.sub(lamp.xy).div(reach);
    heat = heat.add(exp(dot(to, to).negate()).mul(lamp.z));
  }
  return heat.mul(heat);
}

/**
 * How far inside the glass piece a point is: 1 at a knot, falling away
 * from each by its reach (`knots[k].z`), and `PIECE` at the piece's rim.
 */
function pieceAt(u: GlassUniforms, x: V2): F {
  let most: F = float(0);
  for (let k = 0; k < LAMPS; k++) {
    const knot = u.knots.element(k);
    const to = x.sub(knot.xy).div(knot.z.mul(u.scale));
    most = most.max(exp(dot(to, to).negate()));
  }
  return most;
}

/** Whether the piece (the near sheet) can show at `p`: within a facet of its knots' reach. */
function pieceReaches(u: GlassUniforms, p: V2): TslNode<"bool"> {
  const geo = u.sheets.element(0);
  let room: F = float(-1);
  for (let k = 0; k < LAMPS; k++) {
    const knot = u.knots.element(k);
    room = room.max(
      knot.z
        .mul(u.scale)
        .add(geo.z)
        .sub(length(p.sub(knot.xy))),
    );
  }
  return room.greaterThan(0);
}

/** A facet as its shading reads it: its corners' heat, which side of the piece it and its neighbours are on, and how it is turned. */
interface Lit {
  readonly facet: Facet;
  readonly heat: readonly [F, F, F];
  /** 1 for the piece's facets, else 0; then its neighbours across AB, BC and CA. */
  readonly present: F;
  readonly beyond: readonly [F, F, F];
  /** Which of its corners are the piece's: only those burn. */
  readonly corners: readonly [F, F, F];
  /** How much it passes of the lamps behind it, and how much it faces the key, up at the right. */
  readonly facing: F;
  readonly key: F;
  readonly seed: F;
  /** 0 the near sheet (the piece), to 1 the farthest. */
  readonly far: F;
  /**
   * How much of a part of it (its pane, a seam, a corner) centred at `at`,
   * on lattice points summing to `key`, is shown: all of the piece; on a
   * sheet behind it, as much as that part's own standing in the field
   * (`farField`) and the light pooled there. A seam or a corner is judged
   * by itself, so the facets either side of it agree.
   */
  readonly seen: (at: V2, key: V2) => F;
}

/** How far along the edge from `a` to `b` the point nearest `p` lies (0–1), and the edge's length. */
const alongEdge = (p: V2, a: V2, b: V2): readonly [F, F] => {
  const e = b.sub(a);
  return [clamp(dot(p.sub(a), e).div(dot(e, e).add(1e-9)), 0, 1), length(e)];
};

/**
 * The seams' light. Light runs along a crease from a hot corner and dies
 * out over `FLOW`, so most seams fall to nearly nothing and the few that
 * meet at a hot point burn: a fine stroke, white-hot where it is hottest,
 * with a soft spill into both facets, the caustic where they fold. Each
 * crease is as sharp as its own hash. Where the piece ends, its edge is lit
 * from behind, cool, gold near a lamp. The far sheet's seams are soft and
 * dim, lost in the haze.
 */
function seamsOf(u: GlassUniforms, lit: Lit, { p, band, texel }: Pixel): readonly [V3, F] {
  const { facet, heat, present, beyond, seed, far } = lit;
  const inkWidth = texel.mul(1.3).add(far.mul(u.scale).mul(0.008));
  // The sweep glints the piece's seams; a sheet behind it barely catches it.
  const near = far.oneMinus().pow(3);
  const width = texel.mul(1.1).add(far.mul(u.scale).mul(0.008));
  const spillWidth = u.scale.mul(mix(float(0.016), float(0.03), far));
  const fall = u.scale.mul(FLOW);
  const ends: readonly (readonly [V3, V3, V2, V2, F, F])[] = [
    [facet.a, facet.b, facet.ia, facet.ib, heat[0], heat[1]],
    [facet.b, facet.c, facet.ib, facet.ic, heat[1], heat[2]],
    [facet.c, facet.a, facet.ic, facet.ia, heat[2], heat[0]],
  ];
  const dists = [facet.edges.x, facet.edges.y, facet.edges.z] as const;
  let sum: V3 = vec3(0, 0, 0);
  let ink: F = float(0);
  ends.forEach(([a, b, ka, kb, ha, hb], i) => {
    const dist = dists[i] ?? facet.edges.x;
    const other = beyond[i] ?? present;
    const [t, len] = alongEdge(p, a.xy, b.xy);
    const flow = ha
      .mul(exp(t.mul(len).div(fall).negate()))
      .add(hb.mul(exp(t.oneMinus().mul(len).div(fall).negate())));
    const k = hash(ka.add(kb).add(seed.mul(0.71)));
    const crease = k.mul(k).mul(0.85).add(0.15);
    const hot = flow.mul(crease).mul(2.2).add(band.mul(crease).mul(near).mul(0.5)).toVar();
    const line = exp(dist.div(width).pow(2).negate());
    const spill = exp(dist.div(spillWidth).negate());
    const burn = mix(GOLD, WHITE_HOT, smoothstep(0.5, 1.5, hot))
      .mul(hot)
      .mul(line.mul(1.2).add(spill.mul(0.3)));
    // Unlit, a seam is a hair of steel; the piece's outline is back lit.
    const outer = present.sub(other).abs().mul(near);
    const backlit = flow.mul(1.5).add(0.15).min(1);
    const rim = BACKLIT.mul(line.mul(0.07).add(spill.mul(0.02)))
      .mul(outer)
      .mul(backlit);
    const faint = STEEL.mul(line.mul(mix(float(0.02), float(0.025), far)));
    const shown = present.max(other).mul(lit.seen(a.xy.add(b.xy).mul(0.5), ka.add(kb)));
    sum = sum.add(burn.add(rim).add(faint).mul(shown));
    ink = ink.max(exp(dist.div(inkWidth).pow(2).negate()).mul(shown));
  });
  return [sum, ink];
}

/**
 * A facet's own light. The glass is dark until light passes it: each hot
 * corner pours a fan into it that hugs the two seams leaving that corner
 * (light through a fold gathers along it), amber to gold, as much as the
 * facet passes of the lamp behind. The body is slate glass, lighter where it
 * faces the key and toward the lamp's side of the facet, so each plane
 * reads by its turn and the piece by its crumple.
 */
function faceOf(u: GlassUniforms, lit: Lit, { p, texel }: Pixel): readonly [V3, F, F] {
  const { facet, heat, present, facing, key } = lit;
  const spread = u.scale.mul(0.12);
  const hug = u.scale.mul(0.03);
  const corners: readonly (readonly [V3, F, F])[] = [
    [facet.a, heat[0], min(facet.edges.x, facet.edges.z)],
    [facet.b, heat[1], min(facet.edges.x, facet.edges.y)],
    [facet.c, heat[2], min(facet.edges.y, facet.edges.z)],
  ];
  let pour: F = float(0);
  for (const [corner, h, edge] of corners) {
    const fan = h.mul(exp(length(p.sub(corner.xy)).div(spread).negate()));
    pour = pour.add(fan.mul(exp(edge.div(hug).negate()).mul(0.5).add(0.3)));
  }
  const passed = pour.mul(facing.mul(1.6).add(0.45)).toVar();
  const mid = facet.a.add(facet.b).add(facet.c).div(3);
  const main = u.lamps.element(0).xy;
  const sheen = smoothstep(
    -0.6,
    0.6,
    dot(p.sub(mid.xy), normalize(main.sub(mid.xy).add(1e-5))).div(u.scale.mul(0.12)),
  );
  // A sheet behind: only some of its planes catch the light, faint panes across the field, each
  // out of focus, so its edges are soft (and never a low-resolution pass's stair-steps).
  const caught = smoothstep(0.55, 0.95, hash(facet.ia.add(facet.ib).add(facet.ic).add(lit.seed)));
  const inside = min(min(facet.edges.x, facet.edges.y), facet.edges.z);
  const blur = lit.far.mul(u.scale).mul(0.03).add(texel.mul(1.5));
  const pane = smoothstep(0, blur, inside).mul(caught.mul(0.9).add(0.12));
  const seen = lit.seen(mid.xy, facet.ia.add(facet.ib).add(facet.ic)).toVar();
  const shows = mix(present, pane, step(1e-3, lit.far)).mul(seen);
  const body = PANE.mul(
    key
      .mul(mix(float(0.075), float(0.2), lit.far))
      .mul(sheen.mul(0.9).add(0.25))
      .add(0.006),
  );
  return [body.add(mix(AMBER, GOLD, passed.min(1)).mul(passed.mul(1.4))).mul(shows), passed, seen];
}

/** A hot corner's core: warm white in a long amber glow; drawn by every facet that meets there, the piece's or not, so it is never cut. */
function coresOf(u: GlassUniforms, lit: Lit, p: V2): V3 {
  const { facet, heat, corners } = lit;
  const points: readonly (readonly [V3, V2, F, F])[] = [
    [facet.a, facet.ia, heat[0], corners[0]],
    [facet.b, facet.ib, heat[1], corners[1]],
    [facet.c, facet.ic, heat[2], corners[2]],
  ];
  // Only the piece burns: a sheet behind it glows faintly at most.
  const burning = lit.far.oneMinus().pow(2);
  let sum: V3 = vec3(0, 0, 0);
  for (const [corner, k, h, ours] of points) {
    const dist = length(p.sub(corner.xy));
    const tight = exp(dist.div(u.scale.mul(0.01)).pow(2).negate());
    const glow = exp(dist.div(u.scale.mul(0.045)).negate());
    const halo = exp(dist.div(u.scale.mul(0.12)).negate()).add(
      exp(dist.div(u.scale.mul(0.4)).negate()).mul(0.3),
    );
    // A corner near enough a lamp burns whole; the main lamp's nearest, hottest of all.
    const burns = smoothstep(0.08, 0.55, h).mul(h.sqrt().min(1));
    sum = sum.add(
      WHITE_HOT.mul(tight.mul(7).mul(burns))
        .add(AMBER.mul(glow.mul(1.2).mul(burns)))
        .add(AMBER.mul(halo.mul(0.14).mul(burns)))
        .mul(ours.mul(burning).mul(lit.seen(corner.xy, k))),
    );
  }
  return sum;
}

/** Whether a lattice cell splits along its rising diagonal: the same hash `facetAt` splits it by. */
const rising = (cell: V2, seed: F): TslNode<"bool"> =>
  hash(cell.add(seed.add(31.7))).greaterThan(0.5);

/**
 * The lattice corner of the facet across the edge from `ka` to `kb`, from
 * the facet whose third corner is `kc`: across a diagonal it is in the same
 * cell; across a side of the cell, in the next cell, by how that one splits.
 */
function cornerAcross(ka: V2, kb: V2, kc: V2, seed: F): V2 {
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

/** How the facet under `p` on sheet `n` is lit: its corners' heat, membership, and turn. */
function litFacet(u: GlassUniforms, n: number, p: V2): Lit {
  const look = u.sheets.element(n * 2 + 1);
  const far = look.z;
  const seed = look.x;
  const facet = facetAt(u, n, p);
  const { a, b, c, ia, ib, ic, frameOf } = facet;
  // Which facets are the piece's: each whole, every corner's lattice point within reach, so none
  // is cut and none comes and goes as the glass sways. A neighbour across an edge is judged the
  // same, by its own third corner.
  // Only the near sheet is cut to the piece; a sheet behind it is every facet.
  const rim = float(PIECE).mul(step(far, 0));
  const behind = far.mul(-LAMPS_BEHIND).add(1).pow(2);
  const inPiece = (idx: V2): F => step(rim, pieceAt(u, frameOf(idx)));
  const at = [inPiece(ia).toVar(), inPiece(ib).toVar(), inPiece(ic).toVar()] as const;
  const [pa, pb, pc] = at;
  const across = (x: V2, y: V2, z: V2): F => inPiece(cornerAcross(x, y, z, seed));
  const normal = normalize(cross(b.sub(a), c.sub(a)));
  const mid = a.add(b).add(c).div(3);
  let facing: F = float(0);
  for (let k = 0; k < LAMPS; k++) {
    const lamp = u.lamps.element(k);
    const to = normalize(vec3(lamp.xy.sub(mid.xy), float(-LAMP_DEPTH)));
    facing = facing.add(dot(normal, to).abs().pow(6).mul(lamp.z));
  }
  return {
    facet,
    // A sheet behind the piece is beyond the lamps' reach: it barely warms, so only the piece burns.
    heat: [
      heatAt(u, a.xy).mul(behind).toVar(),
      heatAt(u, b.xy).mul(behind).toVar(),
      heatAt(u, c.xy).mul(behind).toVar(),
    ],
    present: pa.mul(pb).mul(pc).toVar(),
    beyond: [
      pa.mul(pb).mul(across(ia, ib, ic)),
      pb.mul(pc).mul(across(ib, ic, ia)),
      pc.mul(pa).mul(across(ic, ia, ib)),
    ],
    corners: at,
    facing: facing.toVar(),
    key: dot(normal, KEY).abs().pow(3).toVar(),
    seed,
    far,
    seen: (centre: V2, key: V2) =>
      mix(
        float(1),
        u.field.standing(centre, hash(key.add(seed.mul(1.37)))).mul(poolAt(u, centre)),
        step(1e-3, far),
      ),
  };
}

/**
 * Sheet `n` over a pixel, added into `sums`. The near sheet is the glass
 * piece, whole facets wherever the piece's knots reach, and hides the field
 * behind it; the far one is the web behind it in the field, every facet,
 * hazed, out of focus and dissolving with the field.
 */
function shadeSheet(u: GlassUniforms, n: number, pixel: Pixel, { light, paper, cover }: Sums) {
  const lit = litFacet(u, n, pixel.p);
  const { far, present, key } = lit;
  // A sheet behind the piece belongs to the field: each of its panes, seams and corners fades
  // whole by where it stands (`Lit.seen`), so the field thins out shape by shape; the piece never
  // fades.
  const [seams, ink] = seamsOf(u, lit, pixel);
  const [face, passed, shown] = faceOf(u, lit, pixel);
  const cores = coresOf(u, lit, pixel.p);
  const own = face.add(seams).add(cores).mul(u.heat);
  // Haze: the far sheet's light is half lost in the navy air, and greyer.
  const hazed = mix(own, HAZE.mul(dot(own, vec3(0.3, 0.5, 0.2))), far.mul(0.55)).mul(
    far.mul(0.6).oneMinus(),
  );
  light.addAssign(hazed);
  cover.assign(cover.max(present.mul(step(far, 0))));
  // A light page, an engraving in the paper's terms: a facet a pale frost, deeper as it turns
  // from the key, peach where light passes it; its seams fine periwinkle ink, apricot where light
  // runs along them; the hot corner an apricot bloom.
  const depth = far.mul(0.6).oneMinus();
  const weight = shown.mul(depth);
  const hotSeam = luminance(seams).mul(1.5).min(1);
  const frost = mix(FROST, PEACH, passed.mul(1.5).min(1));
  paper.mulAssign(
    mix(vec3(1, 1, 1), frost, key.oneMinus().mul(0.55).add(0.3).mul(present).mul(weight)),
  );
  paper.mulAssign(
    mix(
      vec3(1, 1, 1),
      mix(PERIWINKLE, APRICOT, hotSeam),
      ink.mul(hotSeam.mul(0.5).add(0.45)).mul(depth),
    ),
  );
  paper.mulAssign(mix(vec3(1, 1, 1), APRICOT, luminance(cores).mul(2.5).min(0.7)));
}

/**
 * Where light pools in the web behind the piece: broad slow patches across
 * the frame (heights, so a wider frame has more of them), and always about
 * the piece; between them the web falls nearly dark, so the field has light
 * and depth rather than an even pattern.
 */
function poolAt(u: GlassUniforms, at: V2): F {
  const patch = smoothstep(0.4, 0.72, gnoise(at.mul(POOL).add(vec2(u.time.mul(0.006), 3.1))));
  const about = exp(
    length(at.sub(u.knots.element(0).xy))
      .div(u.scale.mul(0.9))
      .negate(),
  );
  return patch.max(about).mul(0.88).add(0.12);
}

const luminance = (c: V3): F => dot(c, vec3(0.2126, 0.7152, 0.0722));

/**
 * The field behind the glass: navy air, lit by the lamps and by the piece
 * they shine through, so it is brightest about the piece and falls away
 * from it by its own light (`left`, its reach), in slow smoke; the piece's
 * shadow on it. Behind that, across the whole frame, the haze the far web
 * hangs in: dimmer the farther it is from the piece, in heights, so a
 * wider frame adds dimmer haze at its sides, and its lower edge the
 * smoke's own folds. The air (dark) and how much of the paper's wash there
 * is (light), and the shadow.
 */
function fieldOf(u: GlassUniforms, { p, warmth, left }: Pixel): readonly [V3, F, F] {
  const drift = vec2(u.time.mul(0.006), u.time.mul(-0.004));
  const smoke = gnoise(p.mul(1.3).add(drift));
  const mist = gnoise(p.mul(3.1).sub(drift.mul(1.7)));
  const cast = smoothstep(
    PIECE * 0.4,
    PIECE * 1.3,
    pieceAt(u, p.add(SHADOW_FALL.mul(u.scale))),
  ).mul(0.65);
  // The lamps light the air behind the glass: a warm glow near each, the cool air far out.
  let air: F = float(0);
  for (let k = 0; k < LAMPS; k++) {
    const lamp = u.lamps.element(k);
    const d = length(p.sub(lamp.xy)).div(u.scale);
    air = air.add(exp(d.div(0.22).negate()).mul(lamp.z).mul(lamp.z));
  }
  const glass = pieceAt(u, p);
  const reach = length(p.sub(u.knots.element(0).xy)).div(u.scale);
  const lit = exp(reach.div(0.75).negate())
    .mul(0.75)
    .add(glass.mul(0.35))
    .mul(smoke.mul(0.8).add(0.6))
    .mul(left);
  const haze = exp(reach.div(HAZE_FALL).negate())
    .mul(0.8)
    .add(0.2)
    .mul(smoothstep(HAZE_LOW[0], HAZE_LOW[1], p.y.add(smoke.sub(0.5).mul(1.1))))
    .mul(mist.mul(0.5).add(0.75))
    // The light pooled in the web lights the haze round it too.
    .mul(poolAt(u, p).mul(0.9).add(0.45))
    .toVar();
  const navy = mix(NAVY_DEEP, NAVY, smoothstep(-0.6, 0.45, p.y));
  const field = navy
    .mul(lit.mul(1.6).add(haze.mul(HAZE_LEVEL)))
    .add(
      HAZE.mul(
        smoothstep(0.25, 0.8, smoke.mul(mist).mul(2))
          .mul(lit.add(haze.mul(0.3)))
          .mul(0.012),
      ),
    )
    .add(AMBER.mul(air.mul(air).mul(0.14).add(warmth.mul(0.012)).mul(u.heat).mul(left)))
    .mul(float(1).sub(cast));
  return [field, left.max(haze.mul(HAZE_PAPER)), cast];
}

/** The pixel a pass shades, at its UV: where it is, the lamps' warmth there, the sweep and the lit air's reach. */
function pixelAt(u: GlassUniforms, texel: F): Pixel {
  const at = uv();
  const p = vec2(mix(u.window.x, u.window.z, at.x), mix(u.window.y, u.window.w, at.y)).toVar();
  const reach = u.scale.mul(u.scale);
  // The lamps' warmth in the air round them.
  const warmth = float(0).toVar();
  for (let k = 0; k < LAMPS; k++) {
    const lamp = u.lamps.element(k);
    const to = p.sub(lamp.xy);
    warmth.addAssign(exp(dot(to, to).div(reach).mul(-6)).mul(lamp.z));
  }
  warmth.assign(warmth.min(1));
  // The sweeping band: every seam it crosses glints.
  const across = dot(p, SWEEP).sub(u.sweep).div(BAND);
  const band = exp(across.mul(across).negate()).toVar();
  // The lit air dissolves into the page softly over a long reach, its rim ragged.
  const left = dissolve(u.reach, p, u.time.mul(0.004)).toVar();
  return { p, texel, warmth, band, left };
}

/** Where light piles up at a hot corner, roll it off softly, keeping its hue, so the core is warm white rather than clipped. */
const rolled = (light: V3): V3 => light.div(luminance(light).mul(0.22).add(1));

/**
 * The field's pass, the background layer: the far web over the air across
 * the whole frame, every facet of it fading whole by where it stands,
 * drawn at a share of the frame's pixels, so it is cheap however wide the
 * frame and as out of focus as a far layer is. Its light (dark), or the
 * paper it leaves (light).
 */
export function fieldFragment(u: GlassUniforms): TslNode<"vec4"> {
  return Fn(() => {
    const pixel = pixelAt(u, u.fieldPixel);
    const light = vec3(0, 0, 0).toVar();
    const paper = vec3(1, 1, 1).toVar();
    const cover = float(0).toVar();
    for (let n = SHEETS - 1; n >= 1; n--) shadeSheet(u, n, pixel, { light, paper, cover });
    const [air, wash, cast] = fieldOf(u, pixel);
    const lit = u.hue.mul(air.add(rolled(light)));
    const print = mix(
      vec3(1, 1, 1),
      mix(WASH, SUNLIT, pixel.warmth.mul(0.5).mul(u.heat.min(1.6))).mul(
        mix(vec3(1, 1, 1), LILAC_SHADE, cast),
      ),
      wash,
    ).mul(paper);
    return vec4(mix(print, lit, u.dark), 1);
  })();
}

/**
 * The glass's pass, the piece above the field: its light (dark) or what it
 * leaves of the paper (light), and how much of the field it hides.
 */
export function pieceFragment(u: GlassUniforms): TslNode<"vec4"> {
  return Fn(() => {
    const pixel = pixelAt(u, u.pixel);
    const light = vec3(0, 0, 0).toVar();
    const paper = vec3(1, 1, 1).toVar();
    const cover = float(0).toVar();
    // A pixel spends nothing on the piece where it cannot be.
    If(pieceReaches(u, pixel.p), () => shadeSheet(u, 0, pixel, { light, paper, cover }));
    return vec4(mix(paper, u.hue.mul(rolled(light)), u.dark), cover);
  })();
}

/**
 * The frame, for `scene.backgroundNode`: the piece (`piece`) in front of
 * the field (`field`), each an offscreen picture, over the page's ground,
 * the field quieter under the head's text, the piece never. The piece hides
 * some of the air behind it.
 */
export function glassFrame(
  u: GlassUniforms,
  { field, piece }: { readonly field: PictureSampler; readonly piece: PictureSampler },
  scrim: ReturnType<typeof textScrim>,
  { ground, page, paint }: Grounds,
): V3 {
  return Fn(() => {
    const aspect = screenSize.x.div(screenSize.y);
    const q = vec2(screenUV.x.sub(0.5).mul(aspect), float(0.5).sub(screenUV.y));
    const span = vec2(u.window.z.sub(u.window.x), u.window.w.sub(u.window.y));
    const at = q.sub(vec2(u.window.x, u.window.y)).div(span);
    const behind = field(at).rgb;
    const glass = piece(at).toVar();
    // The scrim quiets the field under the text, never the piece in front of it.
    const quiet = scrim
      .under(vec2(screenUV.x, float(1).sub(screenUV.y)))
      .mul(glass.a.oneMinus())
      .mul(0.35);
    const seen = behind.mul(glass.a.mul(0.45).oneMinus()).add(glass.rgb);
    const lit = ground.add(seen.mul(float(1).sub(quiet)));
    const print = paint(page.mul(mix(behind.mul(glass.rgb), vec3(1, 1, 1), quiet)));
    return mix(print, lit, u.dark);
  })();
}
