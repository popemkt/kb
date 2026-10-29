/**
 * The wolf medallion's shader (T1): one pass over the frame, reading the
 * relief baked once (`relief.ts`).
 *
 * - **Smoke.** Two folds of noise rising slowly through the field, one
 *   warping the other, lit faintly from below by the embers.
 * - **The circle.** Two fine rings, broken into arcs, and the five glyphs between them
 *   (`medallion.ts`), each stroke a segment's distance, turning slowly. They
 *   smoulder like the embers, and flare a little when the medallion does.
 * - **The medallion** is worn steel over its baked relief: its slope a
 *   texel across, a metal's Fresnel over its surroundings reflected, a
 *   brushed anisotropic highlight running across the lathe's rings, grime
 *   and patina in its cavities, edges rubbed bright, scratches and casting
 *   pits. Where the relief glows (the eyes) a faint light flares (`glow`)
 *   in the colour of what happened (`tint`), with a halo round it.
 * - **The chain**: links up from the bail past the frame's top, face on and
 *   edge on by turns, round wire.
 * - **Embers.** Two layers of sparks rising on the cells of a grid, each
 *   swaying and flickering, dying as they climb.
 * - **It swings** with its chain from a pivot above the frame (`sway`,
 *   `pivot`), so the key light glides over its bevels.
 * - **It dissolves by its own shapes** (`../gpu/dissolve`): the smoke, the
 *   light under it and the embers keep to a reach about the medallion and
 *   thin out at its ragged rim, so the smoke's own folds are its edge,
 *   never a side of the frame.
 * - **Dark** pages are light over the page's ground, which nothing darkens:
 *   the text scrim and the disk's shadow quiet the art, never the ground.
 *   **Light** pages are the same scene on paper (`Grounds`): the same steel
 *   and chain toned for it (polished silver where lit, dark steel in shade,
 *   patina in the recesses) with a faint shadow under it, wash smoke, sepia
 *   glyphs and rust specks for embers.
 */
import {
  Fn,
  cross,
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
  sqrt,
  step,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import { Vector2, Vector3 } from "three/webgpu";
import type { TslNode } from "@kb/scene-gpu";
import { dissolve, dissolveUniforms } from "../gpu/dissolve";
import type { Grounds } from "../gpu/gpu-scene";
import { fbm4, hash, hash2 } from "../gpu/noise";
import type { textScrim } from "../gpu/text-scrim";
import { TAU } from "../scene/math";
import { CIRCLE, GLYPHS } from "./medallion";
import { EXTENT, nearest, toBaked, type BakedRelief } from "./relief";

type F = TslNode<"float">;
type V2 = TslNode<"vec2">;
type V3 = TslNode<"vec3">;

/**
 * Worn steel (linear): its reflectance, rubbed bright on the edges, and the
 * brown-black patina in its recesses; the key light and the embers' warmth;
 * its surroundings, a warm floor and a cool sky; and the darker iron chain.
 */
const STEEL_F0 = vec3(0.56, 0.55, 0.53);
const POLISH_F0 = vec3(0.8, 0.8, 0.78);
const PATINA = vec3(0.06, 0.042, 0.03);
const KEY = vec3(0.72, 0.8, 0.95);
const WARM = vec3(1.0, 0.42, 0.14);
const SKY = vec3(0.12, 0.14, 0.18);
const FLOOR = vec3(0.05, 0.025, 0.012);
const CHAIN = vec3(0.4, 0.4, 0.42);
/** The chain's links (medallion units): how far apart, half their length and width, and the wire's radius. */
const LINK = { pitch: 0.17, length: 0.11, width: 0.07, wire: 0.022 } as const;
/** The smoke, the light under it, the glyphs' smoulder and the embers. */
const SMOKE = vec3(0.03, 0.036, 0.04);
const UNDERGLOW = vec3(0.06, 0.017, 0.004);
/** A warm light behind the medallion, on the smoke round it: what sets it in front of its field. */
const BACKLIGHT = vec3(0.09, 0.045, 0.02);
const SMOULDER = vec3(0.9, 0.3, 0.07);
const EMBER = vec3(1.0, 0.36, 0.07);
/** The light page's inks: the wash, sepia and rust. */
const WASH = vec3(0.66, 0.58, 0.5);
const SEPIA = vec3(0.36, 0.2, 0.1);
const RUST = vec3(0.8, 0.36, 0.16);
/** The steel on a light page: polished where it is lit, dark steel in shade, patina in its recesses. */
const DAY_LIT = vec3(0.9, 0.91, 0.93);
const DAY_SHADE = vec3(0.26, 0.27, 0.3);
const DAY_PATINA = vec3(0.5, 0.42, 0.34);

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
    /** How far the medallion leans toward the viewer's pointer (medallion units): the circle and smoke behind it do not, so it reads as in front. */
    lean: uniform(new Vector2(0, 0)),
    /** Where it swings from (medallion units, above it, past the frame's top), and where the chain leaves its bail. */
    pivot: uniform(2.2),
    bail: uniform(1.12),
    /** The reach the smoke and embers dissolve within. */
    reach: dissolveUniforms(),
    /** How bright the eyes are: a faint light at rest, 1 at a flare. */
    glow: uniform(0.2),
    /** The colour of what happened, which the eyes and the halo take. */
    tint: uniform(new Vector3(1, 0.55, 0.2)),
  };
}
export type MedallionUniforms = ReturnType<typeof medallionUniforms>;

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

/** Small lines scored across the steel at `q` (medallion units): one layer of a cell's random scratch each. */
function scratches(q: V2, cells: number, seed: number): F {
  const at = q.mul(cells);
  const cell = floor(at).add(seed);
  const own = hash(cell);
  const angle = hash(cell.add(1.7)).mul(TAU);
  const dir = vec2(cos(angle), sin(angle));
  const local = fract(at).sub(0.5);
  const across = abs(dot(local, vec2(dir.y.negate(), dir.x)));
  const along = abs(dot(local, dir));
  const length_ = hash(cell.add(4.2)).mul(0.35).add(0.15);
  return step(0.8, own)
    .mul(smoothstep(0.03, 0.0, across))
    .mul(smoothstep(length_, length_.sub(0.08), along));
}

/** Casting pits at `q`: rare small hollows where the metal did not fill the mould. */
function pits(q: V2): F {
  const at = q.mul(70);
  const cell = floor(at);
  const own = hash(cell.add(13.1));
  const centre = hash2(cell).mul(0.6).add(0.2);
  return step(0.955, own).mul(smoothstep(0.32, 0.1, length(fract(at).sub(centre))));
}

/**
 * The medallion at `q` (medallion units, swung) as worn steel, from the
 * baked relief: its slope a texel across, its cavity and its glow, lit by a
 * key, the embers from below and its surroundings, with a brushed
 * anisotropic highlight, grime and patina in the recesses, edges rubbed
 * bright, scratches and casting pits.
 */
function steelAt(relief: BakedRelief, q: V2) {
  const at = toBaked(q);
  const t = relief.texel;
  const maps = relief.maps(at).toVar();
  const dx = relief.maps(at.add(vec2(t, 0))).x.sub(relief.maps(at.sub(vec2(t, 0))).x);
  const dy = relief.maps(at.add(vec2(0, t))).x.sub(relief.maps(at.sub(vec2(0, t))).x);
  const slope = clamp(vec2(dx, dy).div(t * 4 * EXTENT), -3, 3).toVar();
  const cavity = maps.y;
  const silhouette = maps.w;
  // Scratches and pits are tiny grooves: each tips the normal and catches or loses the light.
  const scored = scratches(q, 9, 0)
    .add(scratches(q, 17, 41).mul(0.5))
    .min(1)
    .mul(0.6)
    .toVar();
  const pitted = pits(q).toVar();
  const normal = normalize(vec3(slope.mul(-0.6), float(1).add(pitted.mul(0.6)))).toVar();
  const view = vec3(0, 0, 1);
  // Grime and patina gather where the relief is lower than round it; the edges are rubbed bright.
  const grime = smoothstep(0.02, 0.4, cavity).max(pitted.mul(0.8)).toVar();
  const worn = smoothstep(0.03, 0.3, cavity.negate()).mul(float(1).sub(grime)).toVar();
  const albedo = mix(mix(STEEL_F0, PATINA, grime.mul(0.85)), POLISH_F0, worn.mul(0.7));
  const fresnel = albedo.add(
    vec3(1, 1, 1)
      .sub(albedo)
      .mul(pow(float(1).sub(normal.z), 5)),
  );
  // Brushed on a lathe: the brushing runs round the centre, so the highlight stretches across it.
  const round = normalize(vec3(q.y.negate(), q.x, 0).add(vec3(1e-4, 0, 0)));
  const tangent = normalize(round.sub(normal.mul(dot(normal, round))));
  const bitangent = cross(normal, tangent);
  const lobe = (toLight: V3, along: number, across: number): F => {
    const half = normalize(toLight.add(view));
    const ht = dot(half, tangent).div(along);
    const hb = dot(half, bitangent).div(across);
    const hn = max(dot(half, normal), 1e-3);
    return exp(ht.mul(ht).add(hb.mul(hb)).div(hn.mul(hn)).negate()).mul(
      max(dot(normal, toLight), 0),
    );
  };
  const rough = grime.mul(0.25).add(1);
  const key = vec3(KEY_DIR.x, KEY_DIR.y, KEY_DIR.z);
  const warm = vec3(WARM_DIR.x, WARM_DIR.y, WARM_DIR.z);
  const highlight = KEY.mul(lobe(key, 0.14, 0.5).mul(rough.reciprocal()).mul(1.6))
    .add(WARM.mul(lobe(warm, 0.12, 0.4).mul(0.35)))
    .mul(float(1).sub(grime.mul(0.7)));
  // Its surroundings, reflected: a dim warm floor lit by the embers, a cool sky, a soft window up left.
  const ray = normal.mul(normal.z.mul(2)).sub(view);
  const sky = mix(FLOOR, SKY, smoothstep(-0.5, 0.7, ray.y));
  const window = exp(
    length(ray.xy.sub(vec2(-0.45, 0.5)))
      .pow(2)
      .mul(-10),
  ).mul(0.9);
  const surroundings = sky.add(KEY.mul(window));
  const occluded = float(1).sub(grime.mul(0.8));
  const lit = fresnel
    .mul(surroundings.mul(occluded).add(highlight))
    .add(KEY.mul(scored.mul(lobe(key, 0.5, 0.5).mul(0.5).add(0.03))).mul(occluded))
    .toVar();
  return { silhouette, glow: maps.z, cavity, slope, lit, normal };
}

/**
 * The chain at `q` (medallion units, swung): links up from `bail` to past the
 * frame's top, every other one face on (an oval ring) and the next edge on
 * (a bar), each a round wire lit as the steel is. Its cover and its light.
 */
function chainAt(q: V2, bail: F) {
  const y = q.y.sub(bail);
  const index = floor(y.div(LINK.pitch));
  const local = (k: F) => vec2(q.x, y.sub(k.add(0.5).mul(LINK.pitch)));
  // A face-on link: an oval ring; an edge-on one: a bar as long as the ring is tall.
  const ring = (p: V2): F =>
    abs(
      length(p.div(vec2(LINK.width, LINK.length)))
        .sub(1)
        .mul(LINK.width),
    ).sub(LINK.wire);
  const bar = (p: V2): F =>
    length(vec2(p.x, max(abs(p.y).sub(LINK.length - LINK.wire), 0))).sub(LINK.wire);
  const at = (k: F): F => {
    const even = fract(k.mul(0.5)).lessThan(0.25);
    return even.select(ring(local(k)), bar(local(k)));
  };
  const d = min(at(index), min(at(index.sub(1)), at(index.add(1)))).toVar();
  const cover = smoothstep(fwidth(d).max(1e-4), fwidth(d).negate(), d).mul(step(0, y.add(0.02)));
  // A round wire: lit by how its surface faces the key across the wire.
  const across = clamp(d.negate().div(LINK.wire), 0, 1);
  const tube = sqrt(across);
  const light = KEY.mul(tube.mul(0.25).add(pow(tube, 8).mul(0.6))).mul(CHAIN);
  return { cover, light };
}

/** The frame, for `scene.backgroundNode`. */
export function medallionFrame(
  u: MedallionUniforms,
  relief: BakedRelief,
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

    // It swings from a pivot above, so the medallion and its chain move as one pendulum.
    const pivot = vec2(0, u.pivot);
    const swung = turned(q.sub(u.lean).sub(pivot), u.sway).add(pivot).toVar();
    const { silhouette, glow, cavity, lit } = steelAt(relief, swung);
    const chain = chainAt(swung, u.bail);
    // The eyes' light: a core where the relief glows, a halo past it, and the medallion's halo.
    const core = smoothstep(0.35, 0.9, glow);
    const halo = glow.mul(0.6);
    const aura = exp(max(r.sub(1), 0).mul(-9)).mul(float(1).sub(silhouette));
    const flare = u.glow.sub(0.2).max(0).div(0.8);
    const sparks = embers(p, u.time, 9, 0.08, 0)
      .add(embers(p, u.time, 15, 0.12, 31).mul(0.6))
      .mul(low.mul(0.8).add(0.2))
      .mul(left);
    // Its shadow, a little below and right: its own silhouette, on the smoke (never on the page's own ground).
    const cast = relief
      .maps(toBaked(swung.sub(vec2(0.06, -0.08))))
      .w.mul(float(1).sub(silhouette))
      .mul(0.8);

    // Dark: light over the page's ground, which nothing darkens: smoke, the circle smouldering,
    // the chain, the steel, embers in front, all quieter under the head's text.
    const smoky = SMOKE.mul(dense.mul(1.4))
      .add(UNDERGLOW.mul(low.mul(dense.mul(0.6).add(0.5)).mul(left)))
      .mul(float(1).sub(cast.mul(0.5)))
      .add(SMOULDER.mul(runes.mul(flare.mul(0.5).add(0.32))))
      .add(u.tint.mul(aura.mul(flare).mul(0.22)))
      .add(BACKLIGHT.mul(aura.mul(dense.mul(0.6).add(0.4))));
    const chained = mix(smoky, chain.light.sub(ground).max(smoky), chain.cover);
    const steel = lit.add(u.tint.mul(core.mul(u.glow).mul(5).add(halo.mul(u.glow).mul(0.6))));
    const art = mix(chained, steel.sub(ground), silhouette).add(EMBER.mul(sparks.mul(2.2)));
    const night = ground.add(art.mul(float(1).sub(quiet.mul(0.4))));

    // Light: the same steel on the paper, toned for it: its light as polished silver, its shade
    // as dark steel, patina in its recesses, a faint shadow under it; the smoke a warm wash, the
    // circle in sepia, the embers rust.
    const toned = (light: V3) =>
      mix(DAY_SHADE, DAY_LIT, smoothstep(0.02, 0.42, dot(light, vec3(0.2126, 0.7152, 0.0722))));
    const paper = mix(vec3(1, 1, 1), WASH, dense.mul(0.3))
      .mul(mix(vec3(1, 1, 1), SEPIA, runes.mul(0.7).min(1)))
      .mul(mix(vec3(1, 1, 1), RUST, sparks.mul(0.5).min(1)))
      .mul(float(1).sub(cast.mul(0.2)));
    const chainOnPaper = mix(paper, toned(chain.light), chain.cover);
    const metal = toned(lit).mul(
      mix(vec3(1, 1, 1), DAY_PATINA, smoothstep(0.05, 0.5, cavity).mul(0.55)),
    );
    const inked = mix(chainOnPaper, metal, silhouette);
    const glowing = mix(
      inked,
      u.tint,
      core.mul(u.glow.add(0.4)).mul(0.85).add(aura.mul(flare).mul(0.2)).min(1),
    );
    const day = paint(page.mul(mix(glowing, vec3(1, 1, 1), quiet.mul(0.35))));
    return mix(day, night, u.dark);
  })();
}
