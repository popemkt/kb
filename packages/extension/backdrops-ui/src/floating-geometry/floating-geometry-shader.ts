/**
 * Floating geometry's shaders (T1): one web of low-poly glass facets that
 * tiles the frame on a deep navy field, gold light gathering where facets
 * meet.
 *
 * - **The web** is two sheets (`web.ts`), each a lattice of jittered
 *   triangles solved per pixel: the pixel's cell and its neighbours' are
 *   tried, and the triangle that holds it is the facet it sees, with its
 *   three corners and how far it lies from each edge. Every vertex folds in
 *   depth on a clock of its own (`vertex`), so each facet has a normal and
 *   tilts into and out of the light. Shared corners and edges are solved the
 *   same from either side, so the web is seamless, one sheet, never pieces.
 *   The far sheet's facets are smaller, turned against the near one's, and
 *   dimmer, so the two overlap and their seams cross.
 * - **The light** stands behind the glass: three lamps (`lamps`), the main
 *   one at the main knot. A vertex near a lamp is hot: a warm-white core
 *   with an amber glow round it, the light pouring from it into the facets
 *   that meet there, a gradient toward gold across each, brightest in a
 *   facet that faces the lamp (transmission). The seams are fine strokes,
 *   a pixel or two, that burn gold between hot corners and cool to steel
 *   away from them; a facet far from every lamp is a faint blue pane, so
 *   the web reaches the frame's sides as the reference's does.
 * - **A band of light sweeps across** (`sweep`): every seam it crosses
 *   glints, gold on a dark page and peach on a light one.
 * - **It dissolves by its own shapes** (`../gpu/dissolve`): the field fills
 *   the reach and dissolves at its ragged rim, and the glass thins out by
 *   the same noise a little further in, so no side of the frame ever shows.
 * - **Dark** pages show the light over the navy field on the page's own
 *   ground. **Light** pages show the glass as the other backdrops show a
 *   light page, a soft wash of ink on the paper: each facet a pale frost,
 *   cool away from the lamps and peach near them, its seams fine periwinkle
 *   lines warming toward the lamps, and the lamps' warmth on the paper. It
 *   is composed in the page's own terms (`Grounds`).
 * - **The frame** reads the glass and keeps it quiet under the head's text
 *   (`textScrim`).
 */
import {
  Fn,
  If,
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
import type { TslNode } from "@kb/scene-gpu";
import type { Grounds } from "../gpu/gpu-scene";
import { dissolve, dissolveUniforms } from "../gpu/dissolve";
import { gnoise, hash, hash2 } from "../gpu/noise";
import type { textScrim } from "../gpu/text-scrim";
import { TAU } from "../scene/math";
import { SHEETS } from "./web";

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
const HEAT_REACH = 0.13;
/** How far behind the glass the lamps stand (frame units), so a facet's tilt decides how much of them it passes. */
const LAMP_DEPTH = 0.35;
/** How far a vertex strays from its lattice point, shares of a cell. */
const JITTER = 0.45;
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

/** The way the sweep travels (unit; the scene's `SWEEP_DIR`), and how wide its band is. */
const SWEEP = vec2(0.894, -0.447);
const BAND = 0.11;

const vectors = (n: number) => Array.from({ length: n }, () => new Vector4());

/**
 * Everything the CPU sets. Per sheet: `sheets[2n]` its lattice's origin
 * x y, its cell and its turn (frame units, radians); `sheets[2n+1]` its
 * seed, fold and depth. Per lamp: x y (frame units) and strength.
 */
export function glassUniforms() {
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
    /** One texel of the glass pass, frame units: the width a seam is drawn over. */
    pixel: uniform(0.001),
    /** The reach the art dissolves within. */
    reach: dissolveUniforms(),
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
  const sway = vec2(sin(clock.mul(0.7)), cos(clock.mul(0.9))).mul(0.04);
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

/** What the sheets sum into: the light (dark) and what is left of the paper (light). */
interface Sums {
  readonly light: V3;
  readonly paper: V3;
}

/** What a sheet's shading reads of the pixel: where it is, the lamps' warmth there, the sweep, and how much of the field is left. */
interface Pixel {
  readonly p: V2;
  readonly warmth: F;
  readonly band: F;
  readonly left: F;
}

/** How hot a vertex at `v` is: the lamps near it, each by its strength. */
function heatAt(u: GlassUniforms, v: V2): F {
  let heat: F = float(0);
  const reach = u.scale.mul(HEAT_REACH);
  for (let k = 0; k < LAMPS; k++) {
    const lamp = u.lamps.element(k);
    const to = v.sub(lamp.xy).div(reach);
    heat = heat.add(exp(dot(to, to).negate()).mul(lamp.z));
  }
  return heat;
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

/**
 * Whether sheet `n` can show at `p`: the far one wherever the field is left,
 * the piece within a facet of its knots' reach.
 */
function sheetReaches(u: GlassUniforms, n: number, p: V2, left: F): TslNode<"bool"> {
  const geo = u.sheets.element(n * 2);
  const far = u.sheets.element(n * 2 + 1).z;
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
  return far.greaterThan(0.5).and(left.greaterThan(0.002)).or(room.greaterThan(0));
}

/**
 * Sheet `n` over a pixel, added into `sums`. The near sheet is the glass
 * piece, whole facets wherever the piece's knots reach; the far one is the
 * web behind it in the field, every facet, out of focus and dissolving
 * with the field. Between them, by depth: the farther, the more the field's.
 */
function shadeSheet(
  u: GlassUniforms,
  n: number,
  { p, warmth, band, left }: Pixel,
  { light, paper }: Sums,
) {
  const look = u.sheets.element(n * 2 + 1);
  const seed = look.x;
  const far = look.z;
  const { a, b, c, ia, ib, ic, edges, frameOf } = facetAt(u, n, p);
  // Which facets are the piece's: each whole, by where its lattice cell rests, so none is cut
  // and none comes and goes as the glass sways. A neighbour across an edge is judged the same.
  const rim = float(PIECE).mul(far.oneMinus());
  const inPiece = (idx: V2): F => step(rim, pieceAt(u, frameOf(idx)));
  const present = inPiece(ia.add(ib).add(ic).div(3)).toVar();
  const across = (x: V2, y: V2, z: V2): F => inPiece(x.add(y).mul(2).sub(z).div(3));
  const nab = across(ia, ib, ic);
  const nbc = across(ib, ic, ia);
  const nca = across(ic, ia, ib);
  // The far sheet belongs to the field and dissolves with it; the piece never fades.
  const shown = mix(float(1), left, far);
  const normal = normalize(cross(b.sub(a), c.sub(a)));
  const mid = a.add(b).add(c).div(3);
  let facing: F = float(0);
  for (let k = 0; k < LAMPS; k++) {
    const lamp = u.lamps.element(k);
    const to = normalize(vec3(lamp.xy.sub(mid.xy), float(-LAMP_DEPTH)));
    facing = facing.add(dot(normal, to).abs().pow(8).mul(lamp.z));
  }
  const tint = hash(ia.add(ib).add(ic).add(seed.mul(1.3)));
  // Hot corners: each pours light into the facet, a gradient from the corner across it.
  const ha = heatAt(u, a.xy).toVar();
  const hb = heatAt(u, b.xy).toVar();
  const hc = heatAt(u, c.xy).toVar();
  const spread = u.scale.mul(0.15);
  const da = length(p.sub(a.xy));
  const db = length(p.sub(b.xy));
  const dc = length(p.sub(c.xy));
  const pour = ha
    .mul(exp(da.div(spread).negate()))
    .add(hb.mul(exp(db.div(spread).negate())))
    .add(hc.mul(exp(dc.div(spread).negate())))
    .toVar();
  // The pane: blue glass, lighter where it faces a lamp, toward gold near a hot corner.
  const poured = pour.mul(facing.mul(1.2).add(0.45)).add(warmth.mul(facing).mul(0.03));
  const pane = PANE.mul(tint.mul(tint).mul(0.05).add(0.012).add(facing.mul(0.03)))
    .mul(float(1).sub(poured.min(1).mul(0.7)))
    .add(mix(AMBER, GOLD, poured.min(1)).mul(poured))
    .mul(present);
  // Seams: a stroke a pixel or two wide (the far sheet's out of focus), each as bright as its own
  // hash, gold between hot corners and steel away from them; the sweep glints along them. Where
  // the piece ends, its edge is lit from behind: a cool line, gold near a lamp.
  const width = u.pixel.mul(1.1).add(far.mul(u.scale).mul(0.006));
  const stroke = (
    dist: F,
    [from, to]: readonly [V2, V2],
    [heatFrom, heatTo]: readonly [F, F],
    beyond: F,
  ): V3 => {
    const k = hash(from.add(to).add(seed.mul(0.71)))
      .mul(0.7)
      .add(0.3);
    const hot = heatFrom
      .mul(heatTo)
      .sqrt()
      .add(heatFrom.add(heatTo).mul(0.25))
      .add(band.mul(0.6))
      .min(1.4);
    const line = exp(dist.div(width).pow(2).negate()).add(
      exp(dist.div(width.mul(6)).negate()).mul(0.12),
    );
    const outer = present.sub(beyond).abs();
    const seam = mix(STEEL.mul(0.1), GOLD.mul(1.2), hot.min(1)).mul(k.mul(hot.add(0.3)));
    const back = mix(BACKLIT.mul(0.45), GOLD.mul(1.2), hot.min(1)).mul(k.mul(hot.add(0.5)));
    return mix(seam, back, outer)
      .mul(line.mul(present.max(beyond)))
      .mul(band.mul(1.2).add(1));
  };
  const seams = stroke(edges.x, [ia, ib], [ha, hb], nab)
    .add(stroke(edges.y, [ib, ic], [hb, hc], nbc))
    .add(stroke(edges.z, [ic, ia], [hc, ha], nca));
  // A hot corner's core: warm white, in an amber glow; drawn by every facet that meets there,
  // the piece's or not, so it is never cut.
  const coreOf = (dist: F, heat: F, idx: V2): V3 => {
    const tight = exp(dist.div(u.scale.mul(0.012)).pow(2).negate());
    const glow = exp(dist.div(u.scale.mul(0.05)).negate());
    return WHITE_HOT.mul(tight.mul(3))
      .add(AMBER.mul(glow.mul(0.6)))
      .mul(heat.pow(1.5))
      .mul(step(rim.mul(0.6), pieceAt(u, frameOf(idx))));
  };
  const cores = coreOf(da, ha, ia)
    .add(coreOf(db, hb, ib))
    .add(coreOf(dc, hc, ic));
  light.addAssign(pane.add(seams).add(cores).mul(shown).mul(far.mul(0.45).oneMinus()).mul(u.heat));
  // A light page: a facet is a pale frost, peach toward a hot corner; its seams periwinkle, warming to apricot.
  const hotSeam = ha.add(hb).add(hc).div(3).add(band).min(1);
  const ink = mix(PERIWINKLE, APRICOT, hotSeam);
  const frost = mix(FROST, PEACH, pour.add(warmth.mul(0.5)).min(1));
  const seamLine = exp(min(min(edges.x, edges.y), edges.z).div(width).pow(2).negate());
  const weight = shown.mul(far.mul(0.5).oneMinus());
  paper.mulAssign(mix(vec3(1, 1, 1), frost, tint.mul(0.3).add(0.3).mul(present).mul(weight)));
  paper.mulAssign(
    mix(
      vec3(1, 1, 1),
      ink,
      seamLine
        .mul(weight)
        .mul(present.max(nab.max(nbc).max(nca)))
        .mul(0.65),
    ),
  );
}

/** The glass pass: the light through the glass (dark), or what it leaves of the paper (light). */
export function glassFragment(u: GlassUniforms): TslNode<"vec4"> {
  return Fn(() => {
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
    // Only the field dissolves into the page, softly over a long reach, its rim ragged.
    const left = dissolve(u.reach, p, u.time.mul(0.004)).toVar();
    // The field: navy smoke, and the piece's shadow on it, below and away from the main lamp.
    const smoke = gnoise(p.mul(1.3).add(vec2(u.time.mul(0.006), u.time.mul(-0.004))));
    const cast = smoothstep(
      PIECE * 0.4,
      PIECE * 1.3,
      pieceAt(u, p.add(SHADOW_FALL.mul(u.scale))),
    ).mul(0.6);
    const field = mix(NAVY_DEEP, NAVY, smoothstep(-0.6, 0.45, p.y))
      .mul(smoke.mul(0.7).add(0.65))
      .mul(float(1).sub(cast))
      .add(AMBER.mul(warmth.mul(0.012).mul(u.heat)))
      .mul(left);
    const light = vec3(0, 0, 0).toVar();
    const paper = vec3(1, 1, 1).toVar();
    // Back to front: the far web in the field, where the field is, then the piece above it, near
    // its knots; a pixel spends nothing on a sheet it cannot see.
    const pixel = { p, warmth, band, left };
    for (let n = SHEETS - 1; n >= 0; n--) {
      If(sheetReaches(u, n, p, left), () => shadeSheet(u, n, pixel, { light, paper }));
    }
    // Where light piles up at a hot corner, roll it off softly, keeping its hue, so the core
    // is warm white rather than clipped.
    const piled = dot(light, vec3(0.2126, 0.7152, 0.0722));
    const lit = u.hue.mul(field.add(light.div(piled.mul(0.25).add(1))));
    const print = mix(
      vec3(1, 1, 1),
      mix(vec3(1, 1, 1), SUNLIT, warmth.mul(0.4).mul(u.heat.min(1.6))).mul(
        mix(vec3(1, 1, 1), LILAC_SHADE, cast),
      ),
      left,
    ).mul(paper);
    return vec4(mix(print, lit, u.dark), 1);
  })();
}

/**
 * The frame, for `scene.backgroundNode`: the glass (`glass`, the offscreen
 * picture) over the page's ground, quieter under the head's text.
 */
export function glassFrame(
  u: GlassUniforms,
  glass: (at: V2) => TslNode<"vec4">,
  scrim: ReturnType<typeof textScrim>,
  { ground, page, paint }: Grounds,
): V3 {
  return Fn(() => {
    const aspect = screenSize.x.div(screenSize.y);
    const q = vec2(screenUV.x.sub(0.5).mul(aspect), float(0.5).sub(screenUV.y));
    const span = vec2(u.window.z.sub(u.window.x), u.window.w.sub(u.window.y));
    const seen = glass(q.sub(vec2(u.window.x, u.window.y)).div(span)).rgb.toVar();
    const quiet = scrim.under(vec2(screenUV.x, float(1).sub(screenUV.y))).mul(0.35);
    const lit = ground.add(seen.mul(float(1).sub(quiet)));
    const print = paint(page.mul(mix(seen, vec3(1, 1, 1), quiet)));
    return mix(print, lit, u.dark);
  })();
}
