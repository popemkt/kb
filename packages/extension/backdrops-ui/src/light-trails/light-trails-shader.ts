/**
 * Light trails' shader (T1): long-exposure light streaking across a deep
 * navy field, after the owner's reference tile 09. One pass per pixel and no
 * offscreen picture: each strand (`trails.ts`) is a curve, and a pixel's
 * light is its distance across each.
 *
 * - **Two layers.** The field is the background, and it is the bundle's own
 *   light, never a slab: navy glow about the bundle's path and round the
 *   knot, the far strands (broad, dim, out-of-focus sheens) and a scatter
 *   of sparks drifting with the flow. It runs past the frame's sides, and
 *   toward the head's rows it thins by its smoke's ragged edge
 *   (`glowLeft`), never a line. The near strands and the knot lie above it,
 *   sharp and whole: hairlines with a core and a short glow, white-hot and
 *   finer where they gather.
 * - **A strand** is placed in the hero's units (heights from the knot, at
 *   its scale), so a wider frame shows more of it, never more of them. Its
 *   distance is measured across it (the vertical gap over its slope); its
 *   core is a pixel or two wide when near and wider and dimmer the farther
 *   it is, so depth is focus. It comes and goes along its length (`gap`),
 *   and a packet of light runs along it (`pulse`), stronger with the
 *   owner's writes. Down the frame each strand dies out at a height of its
 *   own (`low`), and under the head's text it all but goes (`textScrim`),
 *   so the bundle thins strand by strand and the title stands clear.
 * - **The knot**: a sharp cyan-white core where the near strands cross, in
 *   a tight bloom, with a long hairline lens streak along the bundle and a
 *   softer one under it, as a lens draws a bright point.
 * - **Dark** pages paint light on navy; **light** pages paint the same
 *   strands as ink on the page's paper: deep cobalt and amber hairlines over
 *   a pale periwinkle wash along the bundle, the knot a point of bare paper
 *   in a cyan bloom and streak (`Grounds`).
 */
import {
  Fn,
  Loop,
  abs,
  dot,
  exp,
  float,
  floor,
  fract,
  length,
  max,
  mix,
  normalize,
  screenSize,
  screenUV,
  sin,
  smoothstep,
  sqrt,
  uniform,
  uniformArray,
  vec2,
  vec3,
} from "three/tsl";
import { Matrix3, Vector3, Vector4 } from "three/webgpu";
import type { TslNode } from "@kb/scene-gpu";
import type { Grounds } from "../gpu/gpu-scene";
import { fbm4, gnoise, hash, hash2 } from "../gpu/noise";
import type { textScrim } from "../gpu/text-scrim";
import { BEND, FAN, KNEE, SLOPE, STRANDS } from "./trails";

type F = TslNode<"float">;
type V2 = TslNode<"vec2">;
type V3 = TslNode<"vec3">;

/** The dark palette (linear): cyan, cobalt, gold, a white-hot core and the navy field. */
const CYAN = vec3(0.14, 0.62, 1.25);
const COBALT = vec3(0.02, 0.12, 0.8);
const GOLD = vec3(1.25, 0.62, 0.12);
const HOT = vec3(1.2, 1.12, 1.0);
/** The knot's core and its streak: a cyan white, as a lens draws a bright point. */
const CORE = vec3(0.9, 1.02, 1.3);
const STREAK = vec3(0.55, 0.85, 1.3);
const FIELD = vec3(0.002, 0.01, 0.045);
const FIELD_DEEP = vec3(0.0004, 0.0015, 0.009);
/** The light palette (shares of the paper): cobalt and amber ink, and the field's wash. */
const INK_COOL = vec3(0.08, 0.22, 0.7);
const INK_WARM = vec3(0.78, 0.42, 0.1);
const INK_FAR = vec3(0.62, 0.72, 0.97);
const WASH = vec3(0.86, 0.9, 1.0);
/** A light page's knot: bare paper in a cyan bloom. */
const INK_CORE = vec3(0.3, 0.62, 1.0);
/** How much wider (against a near one) a strand is at depth 1, and how much of its light is left. */
const FAR_WIDE = 20;
const FAR_DIM = 0.86;
/** A spark's cell along and across the flow (frame units), and how many cells hold one. */
const SPARK_CELL = 0.045;
const SPARK_CHANCE = 0.05;
/** Over how much of the frame's height (frame units) a strand dies out above its own `low`. */
const LOW_SPAN = 0.22;
/** How much of a strand is left under the head's text: the title stands clear. */
const UNDER_TEXT = 0.1;
/** The field's glow toward the head's rows: gone below the first height, whole above the second (frame units), the edge its smoke's. */
const GLOW_LOW = [-0.36, 0.02] as const;

/** Everything the CPU sets. Per strand: `shape` offset fan warm depth, `look` width light amp freq, `run` wave gapFreq gapPhase pulse. */
export function trailUniforms() {
  const shape = Array.from({ length: STRANDS }, () => new Vector4());
  const look = Array.from({ length: STRANDS }, () => new Vector4());
  const run = Array.from({ length: STRANDS }, () => new Vector4());
  const end = Array.from({ length: STRANDS }, () => new Vector4());
  return {
    shape,
    look,
    run,
    /** Per strand: the height it dies out under (`low`). */
    end,
    shapes: uniformArray<"vec4">(shape, "vec4"),
    looks: uniformArray<"vec4">(look, "vec4"),
    runs: uniformArray<"vec4">(run, "vec4"),
    ends: uniformArray<"vec4">(end, "vec4"),
    dark: uniform(1),
    /** The knot, frame units, and its scale. */
    knot: uniform(new Vector3(0.4, 0.05, 1)),
    /** The pointer, frame units, and how near it is (0 away). */
    pointer: uniform(new Vector3(0, 0, 0)),
    /** A frame unit per CSS pixel: 1 over the frame's height. */
    pixel: uniform(1 / 360),
    /** How strongly the light packets run: the owner's writes lift it. */
    pulse: uniform(0),
    time: uniform(0),
    /** This load's few degrees of hue (`hueTurn`). */
    turn: uniform(new Matrix3()),
  };
}
export type TrailUniforms = ReturnType<typeof trailUniforms>;

/** tanh, from `exp`: TSL has none. */
const tanh = (x: F): F => float(1).sub(float(2).div(exp(x.mul(2)).add(1)));

/** The bundle's middle at `u` hero units, and its slope there. */
function bundleAt(u: F): { readonly y: F; readonly slope: F } {
  const th = tanh(u.mul(KNEE));
  return {
    y: u.mul(SLOPE).add(th.mul(BEND)),
    slope: float(SLOPE).add(float(BEND * KNEE).mul(float(1).sub(th.mul(th)))),
  };
}

/** What the strands leave at a pixel: the light on a dark page, and the ink on a light one. */
interface Exposure {
  readonly light: V3;
  /** How much of the paper is left (1 untouched), per channel. */
  readonly paper: V3;
}

/**
 * Every strand's light at `p`, hero units `h` from the knot, back to front
 * in one loop; `quiet` is how far under the head's text `p` is.
 */
function strands(u: TrailUniforms, p: V2, h: V2, quiet: F): Exposure {
  const light = vec3(0, 0, 0).toVar();
  const paper = vec3(1, 1, 1).toVar();
  const s = u.knot.z;
  const mid = bundleAt(h.x);
  const fanned = float(1).sub(exp(h.x.mul(h.x).mul(-FAN)));
  const dfan = h.x.mul(2 * FAN).mul(fanned.oneMinus());
  // Where the knot is, the strands burn white; away from it they keep their colour.
  const knotNear = exp(dot(h, h).mul(-1.6));
  const along = exp(h.x.mul(h.x).mul(-0.3)).mul(0.6).add(0.4);
  const toPointer = p.sub(u.pointer.xy);
  const exposed = exp(dot(toPointer, toPointer).mul(-9)).mul(u.pointer.z).mul(1.4).add(1);
  Loop({ start: 0, end: STRANDS, type: "int", condition: "<" }, ({ i }) => {
    const shape = u.shapes.element(i);
    const look = u.looks.element(i);
    const run = u.runs.element(i);
    const low = u.ends.element(i).x;
    const depth = shape.w;
    const wave = sin(look.w.mul(h.x).add(run.x));
    const y = mid.y.add(shape.x).add(shape.y.mul(fanned)).add(look.z.mul(wave));
    const slope = mid.slope
      .add(shape.y.mul(dfan))
      .add(look.z.mul(look.w).mul(sin(look.w.mul(h.x).add(run.x).add(1.5707963))));
    // Across the strand, in frame units: the vertical gap over its slope, at the knot's scale.
    const d = abs(h.y.sub(y))
      .div(sqrt(slope.mul(slope).add(1)))
      .mul(s);
    // Focus falls off late: the near and mid strands stay hairlines, only the far ones spread.
    // At the knot the near strands draw finer, so the core is a dense sheaf of hairlines.
    const core = look.x
      .mul(u.pixel)
      .mul(depth.pow(3).mul(FAR_WIDE).add(1))
      .mul(knotNear.mul(-0.4).add(1));
    const sharp = exp(d.div(core).pow(2).negate());
    // A near strand's short glow; a far one is all softness already, so it has none.
    const glow = exp(d.div(core.mul(5)).negate()).mul(depth.oneMinus().mul(0.1));
    // It comes and goes along its length, but never at the knot; a packet runs along it.
    const gap = max(
      smoothstep(-0.4, 0.7, sin(run.y.mul(h.x).add(run.z).add(u.time.mul(0.02)))),
      knotNear,
    );
    const packet = fract(h.x.mul(0.18).sub(u.time.mul(0.05)).add(run.w.mul(0.159)));
    const pulse = exp(packet.sub(0.5).mul(14).pow(2).negate()).mul(u.pulse.mul(1.6).add(0.15));
    const amount = sharp
      .add(glow)
      .mul(look.y)
      .mul(gap)
      .mul(along.add(pulse))
      .mul(depth.mul(-FAR_DIM).add(1))
      .mul(exposed)
      // Down the frame it dies out at its own height; under the text it all but goes.
      .mul(smoothstep(low, low.add(LOW_SPAN), p.y))
      .mul(float(1).sub(quiet.mul(1 - UNDER_TEXT)))
      .toVar();
    const colour = mix(mix(CYAN, GOLD, shape.z), COBALT, depth);
    const hot = sharp.mul(knotNear).mul(depth.oneMinus()).mul(0.7);
    light.addAssign(mix(colour, HOT, hot.min(1)).mul(amount));
    const ink = mix(mix(INK_COOL, INK_WARM, shape.z), INK_FAR, depth);
    paper.mulAssign(mix(vec3(1, 1, 1), ink, amount.mul(2.2).min(0.95)));
  });
  return { light, paper };
}

/** Sparks drifting with the flow, thick near the bundle: a hash per cell along and across it. */
function sparks(u: TrailUniforms, p: V2, h: V2): F {
  const dir = normalize(vec2(1, SLOPE));
  const q = vec2(dot(p, dir), dot(p, vec2(dir.y.negate(), dir.x)))
    .div(SPARK_CELL)
    .sub(vec2(u.time.mul(0.25), 0));
  const cell = floor(q);
  const here = hash(cell);
  const at = hash2(cell.add(7.1)).mul(0.8).add(0.1);
  const off = q.sub(cell).sub(at).mul(SPARK_CELL);
  const dot2 = exp(dot(off, off).div(u.pixel.mul(u.pixel).mul(-1.4)));
  const twinkle = sin(u.time.mul(here.mul(3).add(1)).add(here.mul(40)))
    .mul(0.4)
    .add(0.6);
  const nearBundle = exp(abs(h.y.sub(bundleAt(h.x).y)).mul(-2.2));
  return smoothstep(SPARK_CHANCE, 0, here).mul(dot2).mul(twinkle).mul(nearBundle);
}

/**
 * How much of the field's glow is left at `p` toward the head's rows: whole
 * high in the frame, gone low in it, its edge the smoke's own folds,
 * drifting, so it is never a line.
 */
function glowLeft(u: TrailUniforms, p: V2): F {
  const smoke = fbm4(p.mul(2.4).add(vec2(u.time.mul(0.01), u.time.mul(-0.006))));
  return smoothstep(GLOW_LOW[0], GLOW_LOW[1], p.y.add(smoke.sub(0.5).mul(0.26)));
}

/** The knot's light at `k` (frame units from it): its core, its bloom and its lens streaks. */
function knotLight(
  u: TrailUniforms,
  k: V2,
): { readonly core: F; readonly bloom: F; readonly streak: F } {
  const s = u.knot.z;
  const r = length(k).div(s);
  const dir = normalize(vec2(1, SLOPE + BEND * KNEE));
  const along = abs(dot(k, dir)).div(s);
  const across = abs(dot(k, vec2(dir.y.negate(), dir.x)));
  // A hairline drawn far along the bundle, and a softer, shorter one under it.
  const hair = exp(along.div(-0.7)).mul(exp(across.div(u.pixel.mul(1.4)).pow(2).negate()));
  const soft = exp(along.div(-0.22)).mul(exp(across.div(u.pixel.mul(-7))));
  return {
    core: exp(r.div(0.0055).pow(2).negate())
      .mul(5)
      .add(exp(r.div(-0.012)).mul(1.4)),
    // Its wide bloom is a gaussian, so it is gone well short of the frame's bottom.
    bloom: exp(r.div(-0.05))
      .mul(0.28)
      .add(exp(r.div(0.16).pow(2).negate()).mul(0.08)),
    streak: hair.mul(1.1).add(soft.mul(0.3)),
  };
}

/** The frame, for `scene.backgroundNode`. */
export function trailFrame(
  u: TrailUniforms,
  scrim: ReturnType<typeof textScrim>,
  { ground, page, paint }: Grounds,
): V3 {
  return Fn(() => {
    const aspect = screenSize.x.div(screenSize.y);
    const p = vec2(screenUV.x.sub(0.5).mul(aspect), float(0.5).sub(screenUV.y)).toVar();
    // Hero units: heights from the knot, at its scale.
    const h = p.sub(u.knot.xy).div(u.knot.z).toVar();
    const quiet = scrim.under(vec2(screenUV.x, float(1).sub(screenUV.y))).toVar();
    const left = glowLeft(u, p).toVar();

    // The field is the bundle's own light: navy glow about its path and round the knot, in slow
    // smoke, thinning toward the rows by its own ragged edge.
    const off = abs(h.y.sub(bundleAt(h.x).y));
    const smoke = gnoise(h.mul(vec2(0.9, 3.2)).add(vec2(u.time.mul(-0.03), 1.7)));
    const glow = exp(off.mul(-3.2))
      .mul(0.75)
      .add(exp(off.mul(-0.9)).mul(0.3))
      .mul(smoke.mul(0.7).add(0.55))
      .add(exp(dot(h, h).mul(-0.5)).mul(0.35))
      .mul(left)
      .mul(float(1).sub(quiet.mul(0.5)))
      .toVar();
    const field = mix(FIELD_DEEP, FIELD, glow.min(1)).mul(glow.mul(1.6));
    const exposure = strands(u, p, h, quiet);
    const spark = sparks(u, p, h).mul(1.6).mul(left);
    const knot = knotLight(u, p.sub(u.knot.xy));

    const night = field
      .add(exposure.light)
      .add(mix(CYAN, GOLD, 0.45).mul(spark))
      .add(CORE.mul(knot.core))
      .add(STREAK.mul(knot.bloom.add(knot.streak)));
    const bloom = knot.bloom.mul(2).add(knot.streak.mul(0.7)).min(0.8);
    const day = mix(vec3(1, 1, 1), WASH, glow.mul(0.6).min(0.8))
      .mul(exposure.paper)
      .mul(float(1).sub(spark.mul(0.3)))
      .mul(mix(vec3(1, 1, 1), INK_CORE, bloom));
    const bare = mix(day, vec3(1, 1, 1), knot.core.min(1));

    const shownDark = ground.add(u.turn.mul(night).max(0));
    const shownLight = paint(page.mul(mix(u.turn.mul(bare).min(1), vec3(1, 1, 1), quiet.mul(0.3))));
    return mix(shownLight, shownDark, u.dark);
  })();
}
