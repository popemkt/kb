/**
 * The wolf medallion's shader (T1): one pass, no offscreen picture.
 *
 * - **Smoke.** Two folds of noise rising slowly through the field, one
 *   warping the other, lit faintly from below by the embers.
 * - **The circle.** Two fine rings, broken into arcs, and the five glyphs between them
 *   (`medallion.ts`), each stroke a segment's distance, turning slowly. They
 *   smoulder like the embers, and flare a little when the medallion does.
 * - **The medallion.** A height field: the disk, its raised and notched
 *   rim, the mask raised on it in a bevel, and the engraving cut into the
 *   mask. Its slope is a forward difference a pixel across, on the disk alone,
 *   which lights it as dark steel: a cool key from the upper left, the
 *   embers' warmth from below, a hard highlight. The eyes hold a faint
 *   light that flares (`glow`) in the colour of what happened (`tint`), with
 *   a halo round the disk.
 * - **Embers.** Two layers of sparks rising on the cells of a grid, each
 *   swaying and flickering, dying as they climb.
 * - **The medallion swings** a little on its chain (`sway`), so the key
 *   light glides over its bevels.
 * - **It dissolves by its own shapes** (`../gpu/dissolve`): the smoke, the
 *   light under it and the embers keep to a reach about the medallion and
 *   thin out at its ragged rim, so the smoke's own folds are its edge,
 *   never a side of the frame.
 * - **Dark** pages are light over the page's ground, which nothing darkens:
 *   the text scrim and the disk's shadow quiet the art, never the ground.
 *   **Light** pages are the same scene as an engraving in faint ink on the
 *   paper (`Grounds`): wash smoke, sepia glyphs, the disk as its relief's
 *   lines with no fill and no shadow, rust specks for embers.
 */
import {
  Fn,
  vec4,
  If,
  abs,
  atan,
  clamp,
  cos,
  dot,
  exp,
  float,
  floor,
  fract,
  fwidth,
  length,
  max,
  min,
  mix,
  normalize,
  pow,
  screenSize,
  screenUV,
  sin,
  smoothstep,
  step,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import { Vector2, Vector3 } from "three/webgpu";
import type { TslNode } from "@kb/scene-gpu";
import { dissolve, dissolveUniforms } from "../gpu/dissolve";
import type { Grounds } from "../gpu/gpu-scene";
import { fbm4, hash } from "../gpu/noise";
import type { textScrim } from "../gpu/text-scrim";
import { TAU } from "../scene/math";
import { CIRCLE, ENGRAVING, EYES, GLYPHS, MASK, type Point, type Stroke } from "./medallion";

type F = TslNode<"float">;
type V2 = TslNode<"vec2">;
type V3 = TslNode<"vec3">;

/** Steel (linear): the dark disk's body, its key light, and the embers' warmth on it. */
const STEEL = vec3(0.05, 0.055, 0.065);
const KEY = vec3(0.72, 0.8, 0.95);
const WARM = vec3(1.0, 0.42, 0.14);
/** The smoke, the light under it, the glyphs' smoulder and the embers. */
const SMOKE = vec3(0.03, 0.036, 0.04);
const UNDERGLOW = vec3(0.06, 0.017, 0.004);
const SMOULDER = vec3(0.9, 0.3, 0.07);
const EMBER = vec3(1.0, 0.36, 0.07);
/** The light page's inks: the wash, sepia, polished steel and rust. */
const WASH = vec3(0.66, 0.58, 0.5);
const SEPIA = vec3(0.36, 0.2, 0.1);
const POLISHED = vec3(0.1, 0.11, 0.135);
const RUST = vec3(0.8, 0.36, 0.16);

/** The key light and the warm light from below, as directions toward them. */
const KEY_DIR = new Vector3(-0.55, 0.65, 0.6).normalize();
const WARM_DIR = new Vector3(0.15, -0.85, 0.5).normalize();

/** Everything the CPU sets. */
export function medallionUniforms() {
  return {
    dark: uniform(1),
    time: uniform(0),
    /** The disk's centre (frame units, the tremble in it) and radius. */
    centre: uniform(new Vector2(0.3, 0)),
    radius: uniform(0.26),
    /** How far the circle has turned (rad), and how far the medallion has swung on its chain. */
    turn: uniform(0),
    sway: uniform(0),
    /** The reach the smoke and embers dissolve within. */
    reach: dissolveUniforms(),
    /** How bright the eyes are: a faint light at rest, 1 at a flare. */
    glow: uniform(0.2),
    /** The colour of what happened, which the eyes and the halo take. */
    tint: uniform(new Vector3(1, 0.55, 0.2)),
  };
}
export type MedallionUniforms = ReturnType<typeof medallionUniforms>;

/** A stroke's distance from `q`. */
function segment(q: V2, [[ax, ay], [bx, by]]: Stroke): F {
  const ex = bx - ax;
  const ey = by - ay;
  const along = vec2(ex, ey);
  const w = q.sub(vec2(ax, ay));
  const h = clamp(dot(w, along).mul(1 / (ex * ex + ey * ey)), 0, 1);
  return length(w.sub(along.mul(h)));
}

/** The nearest of `strokes` from `q`. */
const nearest = (q: V2, strokes: readonly Stroke[]): F =>
  strokes.map((stroke) => segment(q, stroke)).reduce((a, b) => min(a, b));

/** A closed polygon's signed distance from `q`: negative inside. */
function polygon(q: V2, points: readonly Point[]): F {
  let d: F = float(1e3);
  let sign: F = float(1);
  points.forEach((at, i) => {
    const before = points[(i + points.length - 1) % points.length] ?? at;
    d = min(d, segment(q, [at, before]));
    const ex = before[0] - at[0];
    const ey = before[1] - at[1];
    const above = step(at[1], q.y);
    const below = float(1).sub(step(before[1], q.y));
    const left = step(0, q.y.sub(at[1]).mul(ex).sub(q.x.sub(at[0]).mul(ey)));
    const crosses = above
      .mul(below)
      .mul(left)
      .add(float(1).sub(above).mul(float(1).sub(below)).mul(float(1).sub(left)));
    sign = sign.mul(float(1).sub(crosses.mul(2)));
  });
  return d.mul(sign);
}

/** `q` turned by `angle` (rad). */
const turned = (q: V2, angle: F | number): V2 => {
  const c = cos(angle);
  const s = sin(angle);
  return vec2(q.x.mul(c).sub(q.y.mul(s)), q.x.mul(s).add(q.y.mul(c)));
};

/** The nearest glyph stroke from `q` (medallion units, the circle unturned). */
function glyphs(q: V2): F {
  let d: F = float(1e3);
  GLYPHS.forEach((glyph, i) => {
    // Each glyph stands on the circle, its top outward; the first at the top.
    const at = TAU / 4 + (i * TAU) / GLYPHS.length;
    const centre = vec2(Math.cos(at) * CIRCLE.glyphs, Math.sin(at) * CIRCLE.glyphs);
    const local = turned(q.sub(centre), TAU / 4 - at).div(CIRCLE.glyph);
    d = min(d, nearest(local, glyph.strokes).mul(CIRCLE.glyph));
  });
  return d;
}

/** Sparks rising on a grid of `cells` per frame height at `speed`: their light at `p`. */
function embers(p: V2, time: F, cells: number, speed: number, seed: number): F {
  const q = vec2(p.x.mul(cells), p.y.sub(time.mul(speed)).mul(cells));
  const cell = floor(q).add(seed);
  const own = hash(cell);
  const sway = sin(time.mul(1.3).add(own.mul(TAU))).mul(0.08);
  const at = vec2(
    hash(cell.add(3.1)).mul(0.3).add(0.35).add(sway),
    hash(cell.add(7.7)).mul(0.3).add(0.35),
  );
  const d = length(fract(q).sub(at));
  const flicker = sin(time.mul(7).add(own.mul(40)))
    .mul(0.35)
    .add(0.65);
  // Most sparks are specks; a few are large and bright.
  const size = hash(cell.add(5.3)).pow(3).mul(0.07).add(0.025);
  return step(0.74, own)
    .mul(smoothstep(size, 0.0, d).add(exp(d.mul(d).div(size.mul(size)).mul(-1.2)).mul(0.25)))
    .mul(size.mul(14).add(0.3))
    .mul(flicker);
}

/** The smoke's density at `p`: one fold of noise warping another, rising. */
function smoke(p: V2, time: F): F {
  const st = p.mul(2);
  const slow = fbm4(st.mul(1.4).add(vec2(time.mul(0.016), time.mul(-0.065))));
  return smoothstep(0.35, 0.85, fbm4(st.mul(2.3).add(vec2(slow.mul(1.5), time.mul(-0.11))))).mul(
    slow.mul(0.4).add(0.6),
  );
}

/**
 * The disk's relief at `q` (medallion units; `px` a pixel's width in them):
 * the disk, its rim and notches, the gabled mask and the engraving, and the
 * height they make. No derivatives here, so it can be evaluated again a
 * pixel away, inside a branch.
 */
const reliefFn = Fn(([q, px]: readonly [V2, F]) => {
  const r = length(q);
  const disk = smoothstep(px.add(1), float(1).sub(px), r);
  const rim = smoothstep(0.82, 0.88, r).mul(smoothstep(1, 0.93, r));
  const cell = abs(
    fract(
      atan(q.y, q.x)
        .mul(24 / TAU)
        .add(0.5),
    ).sub(0.5),
  );
  // Each notch's walls slope over a few pixels at least, so they are facets, never one-pixel cliffs.
  const notch = smoothstep(
    px
      .mul(48 / TAU)
      .div(max(r, 0.1))
      .add(0.11),
    float(0.05),
    cell,
  ).mul(rim);
  const mask = smoothstep(0, 0.06, polygon(q, MASK).negate());
  const eyes = nearest(q, EYES);
  const groove = smoothstep(0.03, 0.012, min(nearest(q, ENGRAVING), eyes)).mul(mask);
  // The mask is gabled: a ridge down its middle, so each half takes the light its own way.
  const height = disk
    .mul(0.3)
    .add(rim.mul(0.18))
    .add(mask.mul(abs(q.x).mul(-0.3).add(0.36)))
    .sub(groove.mul(0.12))
    .sub(notch.mul(0.08));
  return vec4(height, disk, mask, groove);
}).setLayout({
  name: "kbMedallionRelief",
  type: "vec4",
  inputs: [
    { name: "q", type: "vec2" },
    { name: "px", type: "float" },
  ],
});

/**
 * The disk at `q` (medallion units, `r` its distance from the centre) as a
 * height field (`reliefFn`), and how the steel takes the light there. Its
 * slope is a forward difference a pixel across, per pixel, on the disk
 * alone: the screen's derivatives are shared by each 2×2 block of pixels,
 * and a highlight on them sparkles along every edge.
 */
function steelAt(q: V2, r: F) {
  const px = fwidth(q.x).max(1e-4).toVar();
  const here = reliefFn(q, px).toVar();
  const slope = vec2(0, 0).toVar();
  If(r.lessThan(1.05), () => {
    const dx = reliefFn(q.add(vec2(px, 0)), px).x.sub(here.x);
    const dy = reliefFn(q.add(vec2(0, px)), px).x.sub(here.x);
    slope.assign(clamp(vec2(dx, dy).div(px), -2.5, 2.5));
  });
  const disk = here.y;
  const mask = here.z;
  const groove = here.w;
  const eyes = nearest(q, EYES).toVar();
  const notchless = float(1).sub(
    smoothstep(0.82, 0.88, r)
      .mul(smoothstep(1, 0.93, r))
      .mul(0.6),
  );
  const normal = normalize(vec3(slope.mul(-0.6), 1));
  const key = max(dot(normal, vec3(KEY_DIR.x, KEY_DIR.y, KEY_DIR.z)), 0);
  const warm = max(dot(normal, vec3(WARM_DIR.x, WARM_DIR.y, WARM_DIR.z)), 0);
  const shine = pow(max(dot(normal, normalize(vec3(KEY_DIR.x, KEY_DIR.y, KEY_DIR.z + 1))), 0), 64)
    .mul(notchless)
    .toVar();
  // Steel reflects its surroundings: bright above, dark below, more so as a surface tilts away
  // (Fresnel), and it is turned on a lathe, so fine rings run round the disk.
  const env = smoothstep(-0.3, 0.9, normal.y).mul(float(1).sub(normal.z).mul(3).add(0.25)).toVar();
  const lathe = fbm4(vec2(r.mul(36), atan(q.y, q.x).mul(1.5)))
    .mul(0.4)
    .add(0.8);
  const relief = length(slope).toVar();
  const lit = key.mul(0.9).add(0.15).toVar();
  return { disk, mask, eyes, groove, lit: lit.mul(lathe), warm, shine, env, relief };
}

/** The frame, for `scene.backgroundNode`. */
export function medallionFrame(
  u: MedallionUniforms,
  scrim: ReturnType<typeof textScrim>,
  { ground, page, paint }: Grounds,
): V3 {
  return Fn(() => {
    const aspect = screenSize.x.div(screenSize.y);
    const p = vec2(screenUV.x.sub(0.5).mul(aspect), float(0.5).sub(screenUV.y)).toVar();
    const low = smoothstep(0.15, 1, screenUV.y);
    const quiet = scrim.under(vec2(screenUV.x, float(1).sub(screenUV.y)));

    const left = dissolve(u.reach, p, u.time.mul(0.01)).toVar();
    const dense = smoke(p, u.time).mul(left).toVar();

    // The medallion's own space: radius 1, y up.
    const q = p.sub(u.centre).div(u.radius).toVar();
    const r = length(q).toVar();

    // The circle: two rings broken into arcs, and the glyphs, turning.
    const spun = turned(q, u.turn.negate()).toVar();
    const angle = atan(spun.y, spun.x).div(TAU).add(0.5);
    const arcs = (n: number, phase: number, gap: number) => {
      const g = fract(angle.mul(n).add(phase));
      return smoothstep(0, 0.015, g).mul(smoothstep(gap, gap - 0.015, g));
    };
    const ring = smoothstep(0.008, 0.002, abs(r.sub(CIRCLE.inner)))
      .mul(arcs(5, 0.05, 0.86))
      .add(smoothstep(0.008, 0.002, abs(r.sub(CIRCLE.outer))).mul(arcs(8, 0.3, 0.9)));
    const glyph = glyphs(spun);
    const runes = smoothstep(0.016, 0.004, glyph)
      .add(exp(glyph.mul(glyph).mul(-900)).mul(0.35))
      .add(ring.mul(0.45))
      .toVar();

    const { disk, mask, eyes, groove, lit, warm, shine, env, relief } = steelAt(
      turned(q, u.sway),
      r,
    );
    // The eyes' light: a core in the slits, a halo past them, and the disk's halo.
    const core = smoothstep(0.035, 0.008, eyes).mul(mask);
    const halo = exp(eyes.mul(eyes).mul(-160)).mul(mask);
    const aura = exp(max(r.sub(1), 0).mul(-9)).mul(float(1).sub(disk));
    const flare = u.glow.sub(0.2).max(0).div(0.8);
    const sparks = embers(p, u.time, 9, 0.08, 0)
      .add(embers(p, u.time, 15, 0.12, 31).mul(0.6))
      .mul(low.mul(0.8).add(0.2))
      .mul(left);
    // The disk's shadow, a little below and right: on the smoke (never on the page's own ground).
    const cast = exp(
      length(q.sub(vec2(0.06, -0.08)))
        .sub(1)
        .max(0)
        .mul(-6),
    ).mul(float(1).sub(disk));

    // Dark: light over the page's ground, which nothing darkens: smoke, the circle smouldering,
    // the steel disk, embers in front, all quieter under the head's text.
    const smoky = SMOKE.mul(dense.mul(1.4))
      .add(UNDERGLOW.mul(low.mul(dense.mul(0.6).add(0.5)).mul(left)))
      .mul(float(1).sub(cast.mul(0.5)))
      .add(SMOULDER.mul(runes.mul(flare.mul(0.5).add(0.32))))
      .add(u.tint.mul(aura.mul(flare).mul(0.22)));
    const steel = STEEL.mul(KEY.mul(lit))
      .add(KEY.mul(env.mul(0.06)))
      .add(STEEL.mul(WARM.mul(warm.mul(0.7))))
      .add(KEY.mul(shine.mul(1.6)))
      .mul(float(1).sub(groove.mul(0.7)))
      .add(u.tint.mul(core.mul(u.glow).mul(5).add(halo.mul(u.glow).mul(0.6))));
    const art = mix(smoky, steel.sub(ground), disk).add(EMBER.mul(sparks.mul(2.2)));
    const night = ground.add(art.mul(float(1).sub(quiet.mul(0.4))));

    // Light: the same scene as an engraving in faint ink on the paper: the disk is its relief's
    // lines and a breath of steel, with no fill and no shadow.
    const paper = mix(vec3(1, 1, 1), WASH, dense.mul(0.3))
      .mul(mix(vec3(1, 1, 1), SEPIA, runes.mul(0.7).min(1)))
      .mul(mix(vec3(1, 1, 1), RUST, sparks.mul(0.5).min(1)));
    const engraved = smoothstep(0.4, 2.5, relief).mul(0.32).add(groove.mul(0.22)).min(0.45);
    const etched = mix(vec3(1, 1, 1), POLISHED, engraved.add(float(1).sub(lit).max(0).mul(0.05)));
    const inked = mix(paper, etched, disk);
    const glowing = mix(
      inked,
      u.tint,
      core.mul(u.glow.add(0.4)).mul(0.85).add(aura.mul(flare).mul(0.2)).min(1),
    );
    const day = paint(page.mul(mix(glowing, vec3(1, 1, 1), quiet.mul(0.35))));
    return mix(day, night, u.dark);
  })();
}
