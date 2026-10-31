/**
 * The wolf medallion's shader (T1): one pass over the frame, reading the
 * relief baked once (`relief.ts`).
 *
 * - **Smoke.** Two layers rising, the near one curled by a slow fold of its
 *   own into eddies and wisps and thickest close about the medallion, lit
 *   by the embers from below and by the warm back light behind the
 *   medallion (`BACK_GLOW`), brightest just past its silhouette.
 * - **The circle.** Two fine rings, broken into arcs, and between them the
 *   glyphs (kb's runes, `medallion.ts`, or the art setting's), one to a
 *   slot, read from the glyph atlas (`../gpu/glyph-atlas`, `glyphs-shader.ts`), turning slowly.
 *   Each glows faintly as light leaking from a groove, a warm pale white
 *   only tinted by its colour, a little in its stroke and more in the soft
 *   bloom round it, breathing on its own slow clock with a faint flicker, never in step;
 *   they flare a little when the medallion does and keep clear of the
 *   head's text.
 * - **The medallion** is worn steel over its baked relief: its slope taken
 *   over the pixel's own footprint (so a fine grain in the source never
 *   sparkles), a metal's Fresnel over its surroundings reflected, a brushed
 *   anisotropic highlight running across the lathe's rings, the key falling
 *   across the face as a gradient with a pin-hot highlight where a bevel
 *   faces it, a hot rim from the smoke's side, a glint circling its bevels
 *   and a broad sheen sweeping across it (`steelLights`), grime and
 *   patina deep in its cavities, edges rubbed bright, scratches and casting
 *   pits, and a darker contact where the chain meets the bail.
 * - **Its eyes** are lights deep in sockets the relief sinks where it glows
 *   (`eye-shader.ts`): a hot core on each socket's floor, its light on the
 *   socket's walls and the metal by it through the steel's own reflectance,
 *   and a halo the relief hides where it hides the light; faint at rest,
 *   flaring (`glow`) in the colour of what happened (`tint`).
 * - **The chain**: links up from the bail past the frame's top, face on and
 *   edge on by turns, round wire.
 * - **Embers.** Two layers of sparks rising on the cells of a grid, each
 *   swaying and flickering, dying as they climb.
 * - **Far layers** (`fieldAt`) cross the whole frame: the far smoke in
 *   soft banks, one to a cell in heights (`banksAt`), each a broad, low
 *   puff drifting and torn by its own folds, never a column; sparks, fewer
 *   than about the medallion; and glyph haze, faint
 *   out-of-focus glyphs one to a cell, clear of the medallion's circle
 *   (`glyphHaze`). Each bank, spark and glyph fades whole by where it
 *   stands (`farField`), toward the frame's sides, its bottom and the text.
 * - **It swings** with its chain from a pivot above the frame (`sway`,
 *   `pivot`), so the key light glides over its bevels.
 * - **It dissolves by its own shapes** (`../gpu/dissolve`): the near smoke
 *   and the light under it keep to a reach about the medallion and thin out
 *   at its ragged rim, so the smoke's own folds are its edge, never a side
 *   of the frame.
 * - **Dark** pages are light over the page's ground, which nothing darkens:
 *   the text scrim and the disk's shadow quiet the field, never the ground
 *   and never the medallion or its chain. **Light** pages are the same
 *   scene on paper (`Grounds`, `dayPicture`): the steel as an object on the
 *   page, its light exposed for the day on a gentle curve (light polished
 *   steel, dark engraving, bright bevels, the soft window partly held back
 *   so it is no fog), a thin warm rim and a warm glint, the chain plain
 *   iron, and a soft contact shadow on the paper below and right; wash
 *   smoke, sepia rings, glyphs in sepia faintly tinted and rust specks for embers.
 * - **Its edge is lit from behind** (`backLight`): a warm light stands
 *   behind the medallion, glowing in the air and on the smoke just past its
 *   silhouette all round, the shadow side too, and catching its own edge as
 *   a thin rim of light (strongest on the smoke's side), never a line drawn
 *   round it.
 */
import {
  Fn,
  cross,
  abs,
  clamp,
  cos,
  dFdx,
  dFdy,
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
import { dissolve, dissolveUniforms, type FarField } from "../gpu/dissolve";
import type { Grounds } from "../gpu/gpu-scene";
import type { GlyphAtlas } from "../gpu/glyph-atlas";
import { fbm4, gnoise, hash, hash2 } from "../gpu/noise";
import type { textScrim } from "../gpu/text-scrim";
import { TAU } from "../scene/math";
import { coreColour, coreSight, socketLight } from "./eye-shader";
import { LUMA, circleAt, glyphHaze, turned } from "./glyphs-shader";
import { EXTENT, RISE, toBaked, type BakedRelief } from "./relief";

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
const SKY = vec3(0.07, 0.08, 0.1);
const FLOOR = vec3(0.05, 0.025, 0.012);
const CHAIN = vec3(0.4, 0.4, 0.42);
/** The chain's links (medallion units): how far apart, half their length and width, and the wire's radius. */
const LINK = { pitch: 0.17, length: 0.11, width: 0.07, wire: 0.022 } as const;
/** The smoke, the light under it, the glyphs' smoulder and the embers. */
const SMOKE = vec3(0.03, 0.036, 0.04);
const UNDERGLOW = vec3(0.06, 0.017, 0.004);
/** A warm light behind the medallion, on the smoke round it: what sets it in front of its field. */
const BACKLIGHT = vec3(0.09, 0.045, 0.02);
/**
 * The back light itself: its glow in the air behind the medallion, how far
 * it reaches (radii from a point a little toward the smoke's side), the
 * glow hugging just past the silhouette, and the rim it lays on the
 * medallion's own edge.
 */
const BACK_GLOW = vec3(0.05, 0.022, 0.008);
const BACK_REACH = 2.4;
const BACK_HUG = vec3(0.16, 0.075, 0.03);
const BACK_RIM = vec3(1.0, 0.66, 0.36);
const SMOULDER = vec3(0.9, 0.3, 0.07);
const EMBER = vec3(1.0, 0.36, 0.07);
/** The light page's inks: the wash, sepia and rust. */
const WASH = vec3(0.66, 0.58, 0.5);
const SEPIA = vec3(0.36, 0.2, 0.1);
const RUST = vec3(0.8, 0.36, 0.16);
/** A glyph's ink on paper: sepia, faintly tinted by its colour (deepened), as its light on a dark page is mostly light. */
const inkOf = (hue: V3): V3 => mix(SEPIA, hue.mul(0.55), 0.3);
/**
 * The steel on a light page: how far its light is exposed for the day and
 * how gentle the curve is (light polished steel, its bevels and glints
 * brightest), its cool tint, the dark patina in its recesses, the warm glint
 * on its bevels, and its wider shadow on the paper past the contact one
 * (where it falls, medallion units, and its colour, a warm grey).
 */
const DAY_EXPOSURE = 2.5;
const DAY_CONTRAST = 1.85;
const DAY_STEEL = vec3(0.92, 0.95, 1.0);
const DAY_INK = vec3(0.08, 0.06, 0.05);
const GLINT = vec3(1.0, 0.62, 0.26);
const DAY_SHADOW_FALL = vec2(0.16, -0.26);
/** The gold the smoke's rim lays in the steel's bevels on a light page, as on a dark one. */
const DAY_GOLD = vec3(0.95, 0.6, 0.2);
/** How much of the soft window's reflection a day's exposure holds back. */
const DAY_WINDOW = 0.5;
const DAY_SHADOW = vec3(0.62, 0.58, 0.55);
/** How much of the paper a unit of the eyes' core covers with its light. */
const DAY_CORE = 0.45;
/** How strongly the far smoke stands in its banks, what share of far cells hold a spark, and how bright the far glyphs smoulder. */
const FAR_SMOKE = 1.5;
const FAR_SPARKS = 0.35;
const FAR_GLYPH_LIGHT = 0.09;
/** The smoke where the embers and the light behind the disk catch it. */
const EMBERLIT = vec3(0.17, 0.07, 0.022);
/** The way the hot rim light comes from: below and right, where the smoke and embers are. */
const RIM_SIDE = vec2(0.35, -0.94);

/** The way the key falls across the face (upper left to lower right), and the way the sheen sweeps, and how often (s). */
const KEY_ACROSS = vec2(-0.65, 0.76);
const SWEEP_WAY = vec2(0.71, -0.71);
const SWEEP_PERIOD = 9;
/** The key light and the warm light from below, as directions toward them. */
const KEY_DIR = new Vector3(-0.55, 0.65, 0.6).normalize();
const WARM_DIR = new Vector3(0.15, -0.85, 0.5).normalize();

/** Everything the CPU sets, and the glyphs it draws into the atlas. */
export function medallionUniforms(field: FarField, glyphs: GlyphAtlas) {
  return {
    /** The circle's glyphs and the far glyphs' haze, whoever drew them. */
    glyphs,
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
    /** The reach the near smoke and its light dissolve within. */
    reach: dissolveUniforms(),
    /** Where the far layers' banks, sparks and glyphs stand across the frame, each fading whole. */
    field,
    /** How bright the eyes are: a faint light at rest, 1 at a flare. */
    glow: uniform(0.2),
    /** The colour of what happened, which the eyes and the halo take. */
    tint: uniform(new Vector3(1, 0.55, 0.2)),
  };
}
export type MedallionUniforms = ReturnType<typeof medallionUniforms>;

/** How much of a far shape centred at a point (frame units) is shown, by its own draw (0–1). */
type Standing = (centre: V2, own: F) => F;

/**
 * Sparks rising on a grid of `cells` per frame height at `speed`: their
 * light at `p`, each spark as present as `standing` says of it, whole.
 */
function embers(
  p: V2,
  time: F,
  [cells, speed, seed]: readonly [number, number, number],
  standing: Standing,
): F {
  const q = vec2(p.x.mul(cells), p.y.sub(time.mul(speed)).mul(cells));
  const home = floor(q);
  const cell = home.add(seed);
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
  const centre = vec2(
    home.x.add(at.x).div(cells),
    home.y.add(at.y).div(cells).add(time.mul(speed)),
  );
  return step(0.74, own)
    .mul(smoothstep(size, 0.0, d).add(exp(d.mul(d).div(size.mul(size)).mul(-1.2)).mul(0.25)))
    .mul(size.mul(14).add(0.3))
    .mul(flicker)
    .mul(standing(centre, hash(cell.add(9.4))));
}

/**
 * The far smoke's banks: one to a cell this wide (frame units); each a
 * broad, low puff this wide and this tall (half-widths), resting between
 * these heights (frame units from the frame's middle) and drifting slowly.
 */
const BANK = { cell: 0.9, wide: [0.3, 0.48], tall: [0.13, 0.2], rest: [-0.12, 0.22] } as const;

/**
 * How much far smoke stands at `p` across the frame: banks, one to a cell
 * (so a wider frame adds more), each a broad, low puff wider than it is
 * tall, drifting and swelling on a slow clock of its own, so the far smoke
 * lies in soft banks torn by its own folds and never stands as a column;
 * each fades whole by where it stands (`farField`).
 */
function banksAt(field: FarField, p: V2, time: F): F {
  const home = floor(p.x.div(BANK.cell));
  let sum: F = float(0);
  for (let k = -1; k <= 1; k++) {
    const cell = home.add(k);
    const h = hash2(vec2(cell, 41.3));
    const own = hash(vec2(cell, 13.7));
    const clock = time.mul(0.03).add(own.mul(TAU));
    const centre = vec2(
      cell.add(h.x.mul(0.6).add(0.2)).mul(BANK.cell).add(sin(clock).mul(0.06)),
      mix(float(BANK.rest[0]), float(BANK.rest[1]), h.y).add(cos(clock.mul(0.7)).mul(0.03)),
    );
    const size = vec2(
      mix(float(BANK.wide[0]), float(BANK.wide[1]), own),
      mix(float(BANK.tall[0]), float(BANK.tall[1]), h.x),
    ).mul(sin(clock.mul(1.3)).mul(0.08).add(1));
    const off = p.sub(centre).div(size);
    const strength = hash(vec2(cell, 7.9)).mul(0.6).add(0.4);
    sum = sum.add(exp(dot(off, off).negate()).mul(strength).mul(field.standing(centre, own)));
  }
  return sum.min(1);
}

/**
 * The far layer of smoke at `p`: one slow fold, larger, rising at `rise`;
 * drawn out a little across, as smoke lying in banks is, never up into
 * streaks.
 */
function farSmoke(p: V2, time: F, rise: number): F {
  return smoothstep(0.45, 0.85, fbm4(p.mul(vec2(1.1, 1.5)).add(vec2(3.7, time.mul(-rise)))));
}

/**
 * The near layer of smoke's density at `p`: rising at `rise`, curled by a
 * slow fold of its own (two noises bending where it is read), so it rolls
 * into eddies and wisps rather than streaks, thin between them.
 */
function smoke(p: V2, time: F, rise: number): F {
  const st = p.mul(2);
  const flow = vec2(time.mul(0.016), time.mul(-0.6 * rise));
  const curl = vec2(
    gnoise(st.mul(0.8).add(flow).add(vec2(1.7, 9.2))),
    gnoise(st.mul(0.8).sub(flow.mul(1.3)).add(vec2(8.3, 2.8))),
  )
    .sub(0.5)
    .mul(1.8);
  const slow = fbm4(st.mul(vec2(1.1, 0.8)).add(curl).add(flow));
  const wisps = fbm4(
    st
      .mul(vec2(2.2, 1.5))
      .add(curl.mul(1.5))
      .add(vec2(slow.mul(1.2), time.mul(-rise))),
  );
  return smoothstep(0.4, 0.78, wisps).mul(slow.mul(0.8).add(0.3));
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

/** How many cells across a medallion unit the pits are scattered on. */
const PIT_CELLS = 70;

/** Casting pits at `q`: rare small hollows where the metal did not fill the mould. */
function pits(q: V2): F {
  const at = q.mul(PIT_CELLS);
  const cell = floor(at);
  const own = hash(cell.add(13.1));
  const centre = hash2(cell).mul(0.6).add(0.2);
  return step(0.955, own).mul(smoothstep(0.32, 0.1, length(fract(at).sub(centre))));
}

/**
 * The medallion at `q` (medallion units, swung) as worn steel, from the
 * baked relief: its slope a texel across, its cavity, its heat and its sockets' light, lit by a
 * key, the embers from below and its surroundings, with a brushed
 * anisotropic highlight, grime and patina in the recesses, edges rubbed
 * bright, scratches and casting pits.
 */
function steelAt(relief: BakedRelief, q: V2, time: F) {
  const at = toBaked(q).toVar();
  // The slope over the pixel's footprint, never finer than a texel: a grain finer than the pixel
  // is averaged away, not sampled into a sparkle.
  const t = max(max(fwidth(at.x), fwidth(at.y)).mul(1.2), float(relief.texel)).toVar();
  const maps = relief.maps(at).toVar();
  const dx = relief.maps(at.add(vec2(t, 0))).x.sub(relief.maps(at.sub(vec2(t, 0))).x);
  const dy = relief.maps(at.add(vec2(0, t))).x.sub(relief.maps(at.sub(vec2(0, t))).x);
  const slope = clamp(vec2(dx, dy).div(t.mul(4 * EXTENT)), -3, 3).toVar();
  const cavity = maps.y;
  const silhouette = maps.w;
  // Scratches and pits are tiny grooves: each tips the normal and catches or loses the light.
  // Each fades out as it grows finer than the pixel, so it never sparkles as a grain.
  const px = fwidth(q.x).max(fwidth(q.y));
  const resolved = (cells: number): F => smoothstep(0.4, 0.15, px.mul(cells));
  const scored = scratches(q, 9, 0)
    .mul(resolved(9))
    .add(scratches(q, 17, 41).mul(0.5).mul(resolved(17)))
    .min(1)
    .mul(0.6)
    .toVar();
  const pitted = pits(q).mul(resolved(PIT_CELLS)).toVar();
  const normal = normalize(vec3(slope.mul(-RISE), float(1).add(pitted.mul(0.6)))).toVar();
  // How far the normal turns across the pixel: the lobes widen by it (geometric specular AA).
  const dnx = dFdx(normal);
  const dny = dFdy(normal);
  const spread = dot(dnx, dnx)
    .add(dot(dny, dny))
    .mul(SPECULAR_AA.variance)
    .min(SPECULAR_AA.most)
    .toVar();
  const view = vec3(0, 0, 1);
  // Grime and patina gather where the relief is lower than round it; the edges are rubbed bright.
  const grime = smoothstep(0.02, 0.4, cavity).max(pitted.mul(0.8)).toVar();
  const worn = smoothstep(0.03, 0.3, cavity.negate()).mul(float(1).sub(grime)).toVar();
  const albedo = mix(mix(STEEL_F0, PATINA, grime.mul(0.85)), POLISH_F0, worn.mul(0.7)).toVar();
  const fresnel = albedo.add(
    vec3(1, 1, 1)
      .sub(albedo)
      .mul(pow(float(1).sub(normal.z), 5)),
  );
  const { highlight, glint, rim } = steelLights({ q, normal, grime, worn, spread }, time);
  // Its surroundings, reflected: a dim warm floor lit by the embers, a cool sky, a soft window up left.
  const ray = normal.mul(normal.z.mul(2)).sub(view);
  const sky = mix(FLOOR, SKY, smoothstep(-0.5, 0.7, ray.y));
  const window = exp(
    length(ray.xy.sub(vec2(-0.45, 0.5)))
      .pow(2)
      .mul(-10),
  ).mul(0.9);
  const surroundings = sky.add(KEY.mul(window.mul(0.8)));
  const occluded = float(1).sub(grime.mul(0.94));
  // What the window alone puts on it: a day's exposure holds it back, or it is a fog over the steel.
  const windowed = fresnel
    .mul(KEY.mul(window.mul(0.8)))
    .mul(occluded)
    .toVar();
  // The key falls across the face from its upper left: a gradient, so the relic is lit, not printed.
  const across = smoothstep(-1.1, 1.1, dot(q, KEY_ACROSS));
  const lit = fresnel
    .mul(
      surroundings
        .mul(occluded)
        .mul(mix(0.45, 1.3, across))
        .add(highlight),
    )
    .add(KEY.mul(scored.mul(across.mul(0.5).add(0.03))).mul(occluded))
    .toVar();
  const surface = { normal, spread, albedo, grime };
  return {
    silhouette,
    heat: maps.z,
    light: relief.light(at),
    surface,
    cavity,
    lit,
    glint,
    windowed,
    rim,
  };
}

/**
 * What the lights put on the steel at a point: where it is (medallion units),
 * its normal, its grime and wear, and how far its normal turns across the
 * pixel (`spread`, a slope's variance), which every lobe widens by.
 */
interface Surface {
  readonly q: V2;
  readonly normal: V3;
  readonly grime: F;
  readonly worn: F;
  readonly spread: F;
}

/**
 * Geometric specular antialiasing (Kaplanyan et al. 2016): a pixel's
 * normals vary by their screen derivatives, and a lobe narrower than that
 * variance is sampled into sparkle, so each lobe's widths (slopes) grow by it,
 * its peak falling as it widens, so its light is the same. `variance` takes
 * the derivatives to a slope's variance; `most` bounds it, so a crease never
 * turns a highlight into a wash.
 */
const SPECULAR_AA = { variance: 0.5, most: 0.18 } as const;

/**
 * The lights on the steel: the key, brushed across the lathe's rings, with
 * a pin-hot highlight where a bevel faces it square; the embers' warmth
 * from below; a low glint circling the disk; a broad sheen sweeping across
 * it every `SWEEP_PERIOD` seconds; and the smoke's hot rim on the bevels
 * that face it (`rim`, kept apart, as a dark page and a light one spend it
 * differently).
 */
function steelLights({ q, normal, grime, worn, spread }: Surface, time: F) {
  const view = vec3(0, 0, 1);
  // Brushed on a lathe: the brushing runs round the centre, so the highlight stretches across it.
  const round = normalize(vec3(q.y.negate(), q.x, 0).add(vec3(1e-4, 0, 0)));
  const tangent = normalize(round.sub(normal.mul(dot(normal, round))));
  const bitangent = cross(normal, tangent);
  const lobe = (toLight: V3, along: number, across: number): F => {
    const half = normalize(toLight.add(view));
    const wideAlong = sqrt(spread.add(along * along));
    const wideAcross = sqrt(spread.add(across * across));
    const ht = dot(half, tangent).div(wideAlong);
    const hb = dot(half, bitangent).div(wideAcross);
    const hn = max(dot(half, normal), 1e-3);
    return exp(ht.mul(ht).add(hb.mul(hb)).div(hn.mul(hn)).negate())
      .mul(max(dot(normal, toLight), 0))
      .mul(
        wideAlong
          .mul(wideAcross)
          .reciprocal()
          .mul(along * across),
      );
  };
  const rough = grime.mul(0.25).add(1);
  const clean = float(1).sub(grime.mul(0.85));
  const key = vec3(KEY_DIR.x, KEY_DIR.y, KEY_DIR.z);
  const warm = vec3(WARM_DIR.x, WARM_DIR.y, WARM_DIR.z);
  // A glint circles the bevels slowly: a low light going round the disk.
  const orbit = time.mul(0.42);
  const circling = normalize(vec3(cos(orbit), sin(orbit), float(0.32)));
  const glint = lobe(circling, 0.07, 0.3).mul(worn.mul(0.8).add(0.5)).mul(clean).toVar();
  // A sheen sweeps across the face, upper left to lower right: a broad light passing over it.
  const along = dot(q, SWEEP_WAY).sub(fract(time.div(SWEEP_PERIOD)).mul(5).sub(2.5));
  const sweep = exp(along.div(0.42).pow(2).negate())
    .mul(lobe(normalize(vec3(SWEEP_WAY.mul(0.6), float(1))), 0.6, 0.6))
    .mul(worn.mul(0.6).add(0.4));
  // The smoke's side lights the bevels that face it: a hot, narrow rim, only the edge on that side.
  const tilt = float(1).sub(normal.z);
  const facingSmoke = max(dot(normalize(normal.xy.add(1e-5)), RIM_SIDE), 0);
  const onSide = smoothstep(0.1, 0.7, dot(normalize(q.add(1e-5)), RIM_SIDE));
  const rim = smoothstep(0.15, 0.6, tilt).mul(facingSmoke.pow(3)).mul(onSide).mul(clean).toVar();
  const highlight = KEY.mul(lobe(key, 0.14, 0.5).mul(rough.reciprocal()).mul(2.8))
    .add(KEY.mul(lobe(key, 0.035, 0.1).mul(9)))
    .add(WARM.mul(lobe(warm, 0.12, 0.4).mul(0.35)))
    .add(KEY.mul(glint.mul(2.6)))
    .add(KEY.mul(sweep.mul(2.6)))
    .mul(clean);
  return { highlight, glint, rim };
}

/**
 * The medallion's silhouette at `q` (medallion units, swung), softened over
 * `spread`: how much of a ring of `taps` round `q` is the medallion. Its
 * halo, the light along its edge and its shadow are this, so they follow
 * its own shape, a sigil's or an image's.
 */
function softSilhouette(relief: BakedRelief, q: V2, spread: number, taps: number): F {
  let sum: F = relief.maps(toBaked(q)).w;
  for (let k = 0; k < taps; k++) {
    const a = ((k + 0.5) / taps) * TAU;
    sum = sum.add(relief.maps(toBaked(q.add(vec2(Math.cos(a), Math.sin(a)).mul(spread)))).w);
  }
  return sum.div(taps + 1);
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

/**
 * The field at `p`, the medallion's background layer: how much of the near
 * reach is left (`left`); two layers of smoke, a far one, slower and
 * larger, about the medallion and in banks across the whole frame, its
 * lower edge its own folds, and a near one in streaks about it; the far
 * glyphs' haze, off the text (`quiet`); and sparks about the medallion and
 * fewer across the frame, each fading whole where it stands, more of them
 * low (`low`).
 */
function fieldAt(
  u: MedallionUniforms,
  p: V2,
  { quiet, low }: { readonly quiet: F; readonly low: F },
) {
  const left = dissolve(u.reach, p, u.time.mul(0.01)).toVar();
  const farther = farSmoke(p, u.time, 0.06);
  const across = left.max(banksAt(u.field, p, u.time).mul(FAR_SMOKE));
  const dense = smoke(p, u.time, 0.11).mul(left).add(farther.mul(0.55).mul(across)).toVar();
  const far = glyphHaze(u, p);
  const clear = float(1).sub(quiet);
  const haze = { amount: far.amount.mul(clear).toVar(), tint: far.tint.mul(clear).toVar() };
  const standing: Standing = (centre, own) =>
    left.max(u.field.standing(centre, own).mul(step(own, FAR_SPARKS)));
  const sparks = embers(p, u.time, [9, 0.08, 0], standing)
    .add(embers(p, u.time, [15, 0.12, 31], standing).mul(0.6))
    .mul(low.mul(0.8).add(0.2))
    .toVar();
  return { left, dense, haze, sparks };
}

/** What the medallion leaves at a pixel, as the dark and the light picture both read it. */
interface Medallion {
  readonly silhouette: F;
  readonly cavity: F;
  readonly lit: V3;
  readonly glint: F;
  readonly windowed: V3;
  readonly rim: F;
}

/**
 * The light from behind the medallion at `q` (medallion units, `r` from its
 * centre; `swung`, as it hangs): it follows its own silhouette, softened, so
 * a sigil's or an image's shape alike. Behind it, a warm glow in the air
 * (`glow`), round the medallion and a little toward the smoke's side, and
 * on the smoke round it, broader on the smoke's side (`aura`, `behind`);
 * on its own edge, that light grazing it all round, the shadow side too, a
 * thin rim inside the silhouette (`rim`), and wrapping further in on the
 * smoke's side (`wrap`), never a line drawn round it; and its shadow on the
 * smoke, a little below and right (`cast`).
 */
function backLight(relief: BakedRelief, swung: V2, { q, r }: { readonly q: V2; readonly r: F }) {
  const inside = relief.maps(toBaked(swung)).w;
  const open = float(1).sub(inside);
  // How much of a small ring round the point is the medallion: outside it, the light behind
  // along its edge; inside it, where the ring is open, its edge, only a thin band of it.
  const ring = softSilhouette(relief, swung, 0.1, 6).toVar();
  const near = ring.mul(open).toVar();
  const behind = softSilhouette(relief, swung, 0.4, 4).mul(open).mul(1.4).min(1);
  const smokeSide = smoothstep(-0.3, 0.9, dot(q.div(r.max(1e-3)), RIM_SIDE));
  const edge = float(1).sub(ring).mul(inside);
  const wrap = smoothstep(0.25, 0.6, edge).mul(smokeSide.mul(0.85).add(0.15));
  const rim = smoothstep(0.3, 0.55, edge).toVar();
  const glow = smoothstep(BACK_REACH, 0.5, length(q.sub(RIM_SIDE.mul(0.3))))
    .pow(2)
    .mul(open);
  const cast = softSilhouette(relief, swung.sub(vec2(0.07, -0.1)), 0.1, 6)
    .mul(open)
    .mul(0.85);
  return { near, aura: near.mul(1.6).min(1), behind, smokeSide, wrap, rim, glow, cast };
}
type BackLight = ReturnType<typeof backLight>;

/**
 * The light page's picture: the steel as a polished object on the paper,
 * exposed for the day (`toned`, its reflections rolled off, so it is light
 * steel with a dark engraving, never a dark disc), a thin warm rim on the
 * smoke's side and the warm glint, and a soft contact shadow on the paper
 * just below and right, with a fainter, wider one past it; the smoke a warm
 * wash, the circle and the far glyphs sepia, the embers rust.
 */
function dayPicture(
  steel: Medallion,
  back: BackLight,
  field: {
    readonly dense: F;
    readonly runes: F;
    readonly rings: F;
    readonly hue: V3;
    readonly haze: { readonly amount: F; readonly tint: V3 };
    readonly sparks: F;
  },
  {
    relief,
    swung,
    chain,
    contact,
    eye,
  }: {
    readonly relief: BakedRelief;
    readonly swung: V2;
    readonly chain: ReturnType<typeof chainAt>;
    readonly contact: F;
    /** The eyes' light on the steel, and their core's light and how much of the pixel it is. */
    readonly eye: { readonly shine: V3; readonly core: V3; readonly cover: F };
  },
): V3 {
  const toned = (light: V3) =>
    vec3(1, 1, 1)
      .sub(exp(pow(light.max(0), vec3(DAY_CONTRAST)).mul(-DAY_EXPOSURE)))
      .mul(DAY_STEEL);
  const open = float(1).sub(steel.silhouette);
  // The contact shadow is the one it casts on the smoke; past it, a fainter, wider one.
  const onPaper = back.cast
    .mul(0.6)
    .add(softSilhouette(relief, swung.sub(DAY_SHADOW_FALL), 0.34, 8).mul(open).mul(0.4));
  const paper = mix(vec3(1, 1, 1), WASH, field.dense.mul(0.2))
    .mul(mix(vec3(1, 1, 1), SEPIA, field.rings.mul(0.7).min(1)))
    .mul(mix(vec3(1, 1, 1), inkOf(field.hue), field.runes.mul(0.85).min(1)))
    .mul(
      mix(
        vec3(1, 1, 1),
        inkOf(field.haze.tint.div(field.haze.amount.max(1e-3))),
        field.haze.amount.mul(0.3).min(1),
      ),
    )
    .mul(mix(vec3(1, 1, 1), RUST, field.sparks.mul(0.5).min(1)))
    .mul(mix(vec3(1, 1, 1), DAY_SHADOW, onPaper.min(0.55)));
  // The chain is plain iron: toned by its light alone, so the curve gives it no cast.
  const iron = dot(chain.light, LUMA);
  const chainOnPaper = mix(paper, toned(vec3(iron, iron, iron)).mul(contact), chain.cover);
  // Polished dark steel: its engraving deep in shadow, its edge darkening where it turns away (so
  // no pale fringe rings it on the paper), the smoke's rim laying gold in its bevels, a warm glint.
  const metal = toned(steel.lit.sub(steel.windowed.mul(DAY_WINDOW)).add(eye.shine))
    .mul(contact)
    .mul(mix(vec3(1, 1, 1), DAY_INK, smoothstep(0.02, 0.32, steel.cavity).mul(0.9)))
    .mul(float(1).sub(back.rim.mul(0.45)))
    .add(DAY_GOLD.mul(steel.rim.mul(0.85)))
    .add(GLINT.mul(steel.glint.add(back.wrap.mul(steel.rim.add(0.15)).mul(0.5))));
  // The core is light on paper too: its own colour, never toned down into the steel's.
  const lit = mix(metal, eye.core, eye.cover);
  return mix(chainOnPaper, lit, smoothstep(0.45, 0.9, steel.silhouette));
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
    const quiet = scrim.under(vec2(screenUV.x, float(1).sub(screenUV.y))).toVar();

    const { left, dense, haze, sparks } = fieldAt(u, p, { quiet, low });

    // The medallion's own space: radius 1, y up.
    const q = p.sub(u.centre).div(u.radius).toVar();
    const r = length(q).toVar();
    // The circle keeps off the head's text, and fades before it reaches the rows' tags low at its right.
    const circle = circleAt(u, q, r);
    const kept = float(1)
      .sub(quiet)
      .mul(smoothstep(-0.48, -0.2, p.y))
      .toVar();
    const runes = circle.glyphs.mul(kept).toVar();
    const rings = circle.rings.mul(kept).toVar();
    const hue = circle.hue.toVar();

    // It swings from a pivot above, so the medallion and its chain move as one pendulum.
    const pivot = vec2(0, u.pivot);
    const swung = turned(q.sub(u.lean).sub(pivot), u.sway).add(pivot).toVar();
    const steel = steelAt(relief, swung, u.time);
    const { silhouette, lit, rim } = steel;
    const chain = chainAt(swung, u.bail);
    // Where the chain meets the bail, each shades the other.
    const bailAt = swung.sub(vec2(0, u.bail));
    const contact = float(1).sub(exp(dot(bailAt, bailAt).mul(-180)).mul(0.6));
    // The eyes: lights deep in their sockets, faint at rest and flaring in what happened's colour.
    const eye = socketLight(steel.surface, {
      light: steel.light,
      heat: steel.heat,
      deep: relief.maps(toBaked(swung.add(coreSight(u.lean)))).z,
      power: u.glow.mul(0.75).add(0.25),
      time: u.time,
    });
    const eyeShine = u.tint.mul(eye.shine).toVar();
    const eyeCore = coreColour(u.tint, eye.white).mul(eye.core).toVar();
    const back = backLight(relief, swung, { q, r });
    const flare = u.glow.sub(0.2).max(0).div(0.8);

    // Dark: light over the page's ground, which nothing darkens: smoke lit from below by the
    // embers and from behind the medallion, the back light glowing in the air behind it and hugging
    // its silhouette, the circle smouldering, the chain, the steel rim lit, embers in front, all
    // quieter under the head's text.
    // The back light is the near smoke's: it keeps to its reach, so it is gone before the frame's bottom.
    const behindGlow = back.glow.mul(left).toVar();
    const smokeLight = low.mul(0.7).add(back.behind.mul(1.8)).add(behindGlow.mul(2.2)).add(0.2);
    const smoky = SMOKE.mul(dense.mul(1.3))
      .add(EMBERLIT.mul(dense.mul(smokeLight)))
      .add(UNDERGLOW.mul(low.mul(dense.mul(0.6).add(0.4)).mul(left)))
      .add(BACK_GLOW.mul(behindGlow))
      .add(BACK_HUG.mul(back.near.mul(back.smokeSide.mul(0.6).add(0.5))))
      .mul(float(1).sub(back.cast.mul(0.7)))
      .add(SMOULDER.mul(rings.mul(flare.mul(0.5).add(0.4))))
      .add(circle.light.mul(kept).mul(flare.mul(0.5).add(0.4)))
      .add(haze.tint.mul(FAR_GLYPH_LIGHT))
      .add(u.tint.mul(back.aura.mul(flare).mul(0.22)))
      .add(BACKLIGHT.mul(back.behind.mul(dense.mul(1.4).add(0.1))).mul(back.smokeSide.add(0.4)));
    const chained = mix(smoky, chain.light.mul(contact).sub(ground).max(smoky), chain.cover);
    const shone = lit
      .mul(contact)
      .add(WARM.mul(rim.mul(2.2).add(back.wrap.mul(0.35))))
      .add(BACK_RIM.mul(back.rim.mul(back.smokeSide.mul(0.5).add(0.3))))
      .add(eyeShine.mul(contact))
      .add(eyeCore)
      .add(u.tint.mul(eye.halo));
    const art = mix(chained, shone.sub(ground), silhouette).add(EMBER.mul(sparks.mul(2.2)));
    // The scrim quiets the field under the text, never the medallion or its chain in front of it.
    const held = float(1).sub(silhouette.max(chain.cover));
    const night = ground.add(art.mul(float(1).sub(quiet.mul(held).mul(0.4))));

    const inked = dayPicture(
      steel,
      back,
      { dense, runes, rings, hue, haze, sparks },
      {
        relief,
        swung,
        chain,
        contact,
        eye: {
          shine: eyeShine.add(u.tint.mul(eye.halo)),
          core: coreColour(u.tint, eye.white),
          // Paper takes light, never more: the core covers it as far as its light runs, so it keeps its falloff.
          cover: eye.core.mul(DAY_CORE).min(1),
        },
      },
    );
    const glowing = mix(inked, u.tint, back.aura.mul(flare).mul(0.2).min(1));
    const day = paint(page.mul(mix(glowing, vec3(1, 1, 1), quiet.mul(held).mul(0.35))));
    return mix(day, night, u.dark);
  })();
}
