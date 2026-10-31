/**
 * Astral's shading (T1): the parts' metal, the needle stars and the sky
 * behind them, each with its dark look and its light one in the same
 * shader, chosen by `dark`.
 *
 * - **Metal** (`partMaterial`). No lights: each solid reflects a studio,
 *   a soft key high at the upper left and a cool strip at the right, over
 *   near-black. A polished face turned to the eye reflects the dark, so it
 *   reads as dark lacquered metal; its bevels turn to the softboxes and
 *   draw it in bright hairlines, the instrument's engraving at every scale.
 *   A circular brushing lays an anisotropic sheen across a wheel's face
 *   (Kajiya–Kay about its turning). What is cut into a face (guilloché,
 *   scales, rings, a star chart, côtes) is computed from the face's own
 *   coordinates and antialiased by its own derivative, and each cut is lit
 *   by which way its wall faces the key, so it glitters as the wheel turns.
 *   A glint sweeps the metal now and then (`sweep`). Silver, champagne,
 *   gilt and blued steel differ by colour alone; a plate is lacquered navy
 *   between champagne lines. A part deep in the haze sinks into the sky.
 * - **On paper** the same solids are ink and gilt on warm paper in a raking
 *   light: a face is the page's paper, its bevels lit on the light's side
 *   and shaded on the other, its outline and its cuts in ink; gilt is
 *   metal still, and blued steel is the Prussian-blue accent.
 * - **Stars** (`starMaterial`): one instanced quad each, facing the eye.
 *   Each is two linear needle tapers crossed (the long one upright), short
 *   diagonals, a bright core and, on a dark page, a halo; HDR at its core,
 *   so the bloom takes it. Its brightness and its spikes' length are
 *   per-star and per-frame (`life`): breathing, a glint where the pointer
 *   is near, the hub's flare at an event.
 * - **The sky** (`astralSky`): on a dark page ink-navy pooled about the
 *   instrument, a slow nebula, a field of tiny stars and four-point glints
 *   (lengthening near the pointer), light shafts with dust drifting
 *   through them, and the rare events: a shooting star and a constellation
 *   drawing itself and fading. On a light one, warm paper with its fibres,
 *   printed specks and marks, and the instrument's soft cast shadow.
 */
import {
  Fn,
  If,
  abs,
  atan,
  clamp,
  cos,
  dot,
  exp,
  faceDirection,
  float,
  floor,
  fract,
  fwidth,
  instancedBufferAttribute,
  instancedDynamicBufferAttribute,
  length,
  max,
  min,
  mix,
  modelViewMatrix,
  normalGeometry,
  normalize,
  normalViewGeometry,
  positionLocal,
  positionView,
  pow,
  reflect,
  screenSize,
  screenUV,
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
import {
  AdditiveBlending,
  DoubleSide,
  type InstancedBufferAttribute,
  MeshBasicNodeMaterial,
  NormalBlending,
  Vector3,
  Vector4,
} from "three/webgpu";
import type { PictureSampler, TslNode } from "@kb/scene-gpu";
import type { Grounds } from "../gpu/gpu-scene";
import type { textScrim } from "../gpu/text-scrim";
import { fbm4, gnoise, hash, hash2 } from "../gpu/noise";
import type { Engraving, Metal, StarTone } from "./astral";

type F = TslNode<"float">;
type V2 = TslNode<"vec2">;
type V3 = TslNode<"vec3">;

/** How many points a constellation has, and how many front discs darken what lies behind them. */
export const CONSTELLATION_POINTS = 7;
export const SHADOWS = 8;
/** A star's quad reaches this far past its long spike's tip, for its glint and its needles. */
export const STAR_REACH = 1.9;

/** Everything the CPU sets, shared by the sky, the metal and the stars. */
export function astralUniforms() {
  const constellation = Array.from({ length: CONSTELLATION_POINTS }, () => new Vector4());
  const shadows = Array.from({ length: SHADOWS }, () => new Vector4());
  return {
    dark: uniform(1),
    time: uniform(0),
    /** The studio's key (view space): high at the upper left, swung a little toward the pointer. */
    key: uniform(new Vector3(-0.55, 0.62, 0.55).normalize()),
    /** The glint sweeping the metal: where across the view (frame units), and how strong. */
    sweep: uniform(new Vector3(-9, 0, 0)),
    /** The hub's flare at an event, 0–1. */
    flare: uniform(0),
    /** The instrument's centre (frame units) and its scale. */
    hero: uniform(new Vector3(0, 0, 1)),
    /** The pointer (frame units) and how near it is, 0–1. */
    pointer: uniform(new Vector3(0, 0, 0)),
    /** A shooting star: its head (frame units), its heading, and its life (0 none, 0–1 under way). */
    shooting: uniform(new Vector4(0, 0, 0, 0)),
    /** The constellation drawing itself: each point x y size and how far it has appeared. */
    constellation,
    points: uniformArray<"vec4">(constellation, "vec4"),
    /** How far the constellation's lines have drawn, 0–1. */
    lines: uniform(0),
    /** The light shafts, how present (0–1). */
    shafts: uniform(0.5),
    /** On paper: each disc casting a shadow, x y r strength (frame units). */
    casts: shadows,
    shadows: uniformArray<"vec4">(shadows, "vec4"),
    /** The detail the sky spends, 0–1 (`BackdropLayout.quality`). */
    detail: uniform(1),
  };
}
export type AstralUniforms = ReturnType<typeof astralUniforms>;

/** Where the studio's key rests (view space), and the strip at the right. */
export const KEY_REST = new Vector3(-0.55, 0.62, 0.55).normalize();
const STRIP = vec3(0.9, 0.05, 0.42).normalize();
/** On paper, the raking light: low, from the upper left. */
const RAKE = vec3(-0.75, 0.5, 0.42).normalize();
const RAKE_FACE = 0.42 / Math.hypot(0.75, 0.5, 0.42);

/** Each metal on a dark page (linear). */
const METALS: Readonly<Record<Metal, readonly [number, number, number]>> = {
  plate: [0.86, 0.74, 0.52],
  champagne: [0.95, 0.82, 0.58],
  silver: [0.84, 0.88, 0.94],
  gilt: [1.0, 0.72, 0.34],
  blued: [0.26, 0.44, 0.92],
};
/** The ink and the gilt of the paper look (linear). */
const INK = vec3(0.016, 0.02, 0.034);
const GRAPHITE = vec3(0.12, 0.13, 0.15);
const GILT = vec3(0.55, 0.36, 0.11);
const PRUSSIAN = vec3(0.025, 0.07, 0.2);
/** The lacquer between a plate's lines, and the navy the sky pools to. */
const LACQUER = vec3(0.006, 0.011, 0.03);
const NAVY = vec3(0.006, 0.012, 0.034);

/** A cut of width `w` (face units) at signed distance `d`: antialiased, thinned to a hairline below a pixel. */
function cut(d: F, w: number): F {
  const aa = fwidth(d).max(1e-5);
  const half = max(aa.mul(0.6), float(w / 2));
  return smoothstep(half.add(aa.mul(0.5)), half.sub(aa.mul(0.5)), abs(d)).mul(
    min(float(1), float(w).div(half.mul(2))),
  );
}

/** Inside `[from, to]` of radius, antialiased. */
function band(r: F, from: number, to: number): F {
  const aa = fwidth(r).max(1e-5);
  return smoothstep(float(from).sub(aa), float(from).add(aa), r).mul(
    smoothstep(float(to).add(aa), float(to).sub(aa), r),
  );
}

/** One cut pattern: how much of a pixel is cut, how strong its line is, and which way its walls face (face units). */
interface Cut {
  readonly cover: F;
  readonly weight: number;
  readonly wall: V2;
}

/** The pattern an engraving cuts, at `p` (face units), radius `r`, angle `a`. */
function engrave(e: Engraving, p: V2, r: F, a: F): Cut {
  const radial = p.div(r.max(1e-4));
  const tangent = vec2(radial.y.negate(), radial.x);
  switch (e.kind) {
    case "rings": {
      let cover: F = float(0);
      for (const radius of e.radii) cover = cover.max(cut(r.sub(radius), 0.0042));
      return { cover, weight: 0.85, wall: radial };
    }
    case "guilloche": {
      const spacing = (e.to - e.from) / Math.max(1, e.lines - 1);
      const wave = sin(a.mul(e.petals))
        .mul(spacing * 0.32)
        .add(sin(a.mul(12).add(1)).mul(spacing * 0.2));
      const q = r.add(wave).sub(e.from).div(spacing);
      const d = fract(q.add(0.5)).sub(0.5).mul(spacing);
      return {
        cover: cut(d, 0.0026).mul(band(r, e.from - spacing * 0.3, e.to + spacing * 0.3)),
        weight: 0.5,
        wall: radial,
      };
    }
    case "scale": {
      const n = a.div(Math.PI * 2).mul(e.ticks);
      const index = floor(n.add(0.5));
      const d = n
        .sub(index)
        .mul((Math.PI * 2) / e.ticks)
        .mul(r);
      const major = step(index.sub(floor(index.div(e.major)).mul(e.major)), float(0.5));
      const span = e.to - e.from;
      // A minor tick runs in from the outer edge two fifths of the band; a major one the whole of it.
      const reach = mix(float(e.to - span * 0.42), float(e.from), major);
      const inBand = smoothstep(reach.sub(0.002), reach.add(0.002), r).mul(band(r, e.from, e.to));
      const width = mix(float(0.0032), float(0.0058), major);
      const aa = fwidth(d).max(1e-5);
      const half = max(aa.mul(0.6), width.div(2));
      const line = smoothstep(half.add(aa.mul(0.5)), half.sub(aa.mul(0.5)), abs(d)).mul(
        min(float(1), width.div(half.mul(2))),
      );
      return { cover: line.mul(inBand), weight: 0.95, wall: tangent };
    }
    case "chart": {
      // Circles of declination, every other one dashed, and the twelve hour arcs curving to the pole.
      const ring = e.radius / 6;
      const q = r.div(ring);
      const k = floor(q.add(0.5));
      const odd = k.sub(floor(k.div(2)).mul(2));
      const dash = mix(float(1), step(fract(a.mul(48).div(Math.PI)), 0.55), odd);
      let cover: F = cut(q.sub(k).mul(ring), 0.0028)
        .mul(dash)
        .mul(band(r, ring * 0.5, e.radius));
      const off = e.radius * 0.55;
      for (let i = 0; i < 12; i++) {
        const t = (i * Math.PI * 2) / 12;
        const centre = vec2(off * Math.cos(t), off * Math.sin(t));
        cover = cover.max(cut(length(p.sub(centre)).sub(off), 0.0024).mul(band(r, 0.02, e.radius)));
      }
      return { cover, weight: 0.6, wall: radial };
    }
    case "cotes": {
      const d = fract(p.x.mul(26).add(0.5)).sub(0.5).div(26);
      return { cover: cut(d, 0.0022), weight: 0.16, wall: vec2(1, 0) };
    }
    case "spiral": {
      // Archimedes: radius rises one pitch a turn, so the distance to the nearest coil is periodic.
      const pitch = (e.to - e.from) / e.coils;
      const turn = a.div(Math.PI * 2).add(0.5);
      const q = r.sub(e.from).div(pitch).sub(turn);
      const d = fract(q.add(0.5)).sub(0.5).mul(pitch);
      return { cover: cut(d, 0.0034).mul(band(r, e.from, e.to)), weight: 1, wall: radial };
    }
    default:
      return e satisfies never;
  }
}

/** What a part is cut and finished with, decided when its material is made. */
export interface PartFinish {
  readonly metal: Metal;
  readonly engravings: readonly Engraving[];
  readonly haze: number;
  /** A flat part whose face lies in its XY plane: it may be brushed and engraved. */
  readonly flat: boolean;
}

/** Where a pixel lies in the frame (frame units: height 1, centre 0, y up). */
const frameAt = (): V2 =>
  vec2(screenUV.x.sub(0.5).mul(screenSize.x.div(screenSize.y)), float(0.5).sub(screenUV.y));

/**
 * How much light the instrument's front parts leave at `p`: each casts a
 * soft disc of shadow down and to the right of it (`shadows`), on the sky
 * and on the wheels behind it.
 */
function contact(u: AstralUniforms, p: V2): F {
  let lit: F = float(1);
  for (let i = 0; i < SHADOWS; i++) {
    const disc = u.shadows.element(i);
    const soft = disc.z.mul(0.09).add(0.012);
    const cover = smoothstep(
      disc.z.add(soft),
      disc.z.sub(soft.mul(0.6)),
      length(p.sub(disc.xy)),
    ).mul(disc.w);
    lit = lit.mul(float(1).sub(cover));
  }
  return lit;
}

/** A part's material: its metal on a dark page, ink and gilt on paper on a light one. */
export function partMaterial(
  u: AstralUniforms,
  grounds: Grounds,
  finish: PartFinish,
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.side = DoubleSide;
  const metal = vec3(...METALS[finish.metal]);
  material.colorNode = Fn(() => {
    const n = normalize(normalViewGeometry).mul(faceDirection).toVar();
    const v = normalize(positionView.negate()).toVar();
    const r = reflect(v.negate(), n);
    const key = u.key;
    const keyAcross = normalize(key.xy);
    // The studio: a soft key at the upper left, a strip at the right, a little fill above.
    const env = smoothstep(0.7, 0.97, dot(r, key))
      .mul(0.92)
      .add(smoothstep(0.86, 0.995, dot(r, STRIP)).mul(0.6))
      .add(smoothstep(-0.2, 1, r.y).mul(0.05))
      .add(0.018)
      .toVar();
    // Where on the view the glint sweeps: frame units across, leaning.
    const across = positionView.x
      .div(positionView.z.negate())
      .add(positionView.y.div(positionView.z.negate()).mul(0.35));
    const glint = exp(across.sub(u.sweep.x).div(0.06).pow(2).negate()).mul(u.sweep.y).toVar();
    const face = finish.flat ? smoothstep(0.86, 0.97, abs(normalGeometry.z)) : float(0);
    const p = positionLocal.xy;
    const radius = length(p).toVar();
    const angle = atan(p.y, p.x);
    // Brushed in circles about its axis: a sheen across the face, perpendicular to the brushing.
    const brushing = normalize(modelViewMatrix.mul(vec4(p.y.negate(), p.x, 0, 0)).xyz.add(1e-5));
    const half = normalize(key.add(v));
    const th = dot(brushing, half);
    const sheen = finish.flat
      ? pow(max(float(1).sub(th.mul(th)), 0).sqrt(), 900)
          .mul(0.3)
          .mul(face)
      : float(0);
    // The cuts, each lit by which way its walls face the key.
    let cuts: F = float(0);
    for (const e of finish.engravings) {
      const c = engrave(e, p, radius, angle);
      const wall = normalize(modelViewMatrix.mul(vec4(c.wall, 0, 0)).xy.add(1e-5));
      const facing = abs(dot(wall, keyAcross)).mul(0.65).add(0.35);
      cuts = cuts.add(c.cover.mul(c.weight).mul(facing));
    }
    const cutsOnFace = cuts.min(1).mul(face).toVar();
    // A part behind the instrument lies in its front parts' shadow.
    const shaded = (finish.haze > 0 ? contact(u, frameAt()) : float(1)).toVar();
    const shown = vec3(0, 0, 0).toVar();
    If(u.dark.greaterThan(0.5), () => {
      // Dark: the reflected studio in the metal's colour, the lacquer of a plate, the cuts bright.
      const body =
        finish.metal === "plate" ? LACQUER.add(metal.mul(env.mul(0.28))) : metal.mul(env.mul(0.95));
      const night = body
        .add(metal.mul(sheen.mul(env.mul(0.5).add(0.6))))
        .add(metal.mul(cutsOnFace.mul(glint.mul(1.8).add(0.42))))
        .add(metal.mul(glint.mul(env.add(0.08)).mul(0.9)))
        .mul(shaded.mul(0.6).add(0.4));
      shown.assign(
        mix(
          grounds.ground.add(night),
          grounds.ground.add(NAVY.mul(1.4)).add(night.mul(0.18)),
          finish.haze * 0.78,
        ),
      );
    }).Else(() => {
      // Paper: the page lit by the raking light, its bevels lit and shaded, its outline and cuts in ink.
      const rake = dot(n, RAKE).sub(RAKE_FACE);
      const shade = float(1).add(rake.mul(0.85)).clamp(0.45, 1.12);
      const edge = finish.flat ? float(1).sub(face) : float(0.15);
      const page = grounds.page;
      const inkOf = finish.metal === "silver" ? GRAPHITE : INK;
      const paperBody = (() => {
        switch (finish.metal) {
          case "gilt":
            return GILT.mul(env.mul(1.4).add(0.55)).add(glint.mul(0.3));
          case "blued":
            return PRUSSIAN.mul(env.mul(1.2).add(0.8));
          // A wash of its metal on the paper, so a face reads as a solid and not as the page.
          case "plate":
            return mix(page.mul(vec3(1.0, 0.975, 0.93)), GILT, 0.06).mul(shade);
          case "champagne":
            return mix(page, GILT, env.mul(0.45).add(0.32)).mul(shade);
          case "silver":
            return mix(page, GRAPHITE, env.mul(0.2).add(0.2)).mul(shade);
          default:
            return finish.metal satisfies never;
        }
      })();
      const inked = mix(paperBody, inkOf, cutsOnFace.mul(1.7).add(edge).min(0.95));
      shown.assign(
        grounds.paint(mix(inked, page, finish.haze * 0.7).mul(shaded.mul(0.35).add(0.65))),
      );
    });
    return vec4(shown, 1);
  })();
  return material;
}

/** Each tone on a dark page, and on paper (linear). */
const NIGHT_TONES: Readonly<Record<StarTone, readonly [number, number, number]>> = {
  ivory: [1.0, 0.95, 0.86],
  champagne: [0.95, 0.8, 0.55],
  ice: [0.6, 0.82, 1.0],
  gilt: [1.0, 0.74, 0.38],
  ink: [0.9, 0.78, 0.56],
};
const DAY_TONES: Readonly<Record<StarTone, readonly [number, number, number]>> = {
  ivory: [0.62, 0.42, 0.13],
  champagne: [0.03, 0.035, 0.055],
  ice: [0.025, 0.07, 0.2],
  gilt: [0.6, 0.4, 0.12],
  ink: [0.016, 0.02, 0.034],
};
export const STAR_TONES: readonly StarTone[] = ["ivory", "champagne", "ice", "gilt", "ink"];

/** The tone `index` names (`STAR_TONES`), from `table`. */
function toneOf(
  index: F,
  table: Readonly<Record<StarTone, readonly [number, number, number]>>,
): V3 {
  let colour: V3 = vec3(...table.ivory);
  STAR_TONES.forEach((tone, i) => {
    if (i > 0) colour = mix(colour, vec3(...table[tone]), step(i - 0.5, index));
  });
  return colour;
}

/** One needle spike along `along`, `length` long, `waist` wide at the centre, tapering linearly to its tip. */
function spike(along: F, across: F, reach: F, waist: F, aa: F): F {
  const k = clamp(float(1).sub(abs(along).div(reach)), 0, 1);
  const w = waist.mul(k).add(aa);
  return pow(k, 1.3)
    .mul(exp(across.div(w).pow(2).negate()))
    .mul(waist.mul(k).div(w).add(0.25).min(1));
}

/**
 * The stars' material: `shape` per star holds its tone, its cross spike's
 * share, its angle and whether it is the hub; `life` its brightness and its
 * spikes' length this frame.
 */
export function starMaterial(
  u: AstralUniforms,
  grounds: Grounds,
  shape: InstancedBufferAttribute,
  life: InstancedBufferAttribute,
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.blending = AdditiveBlending;
  const own = instancedBufferAttribute<"vec4">(shape);
  const now = instancedDynamicBufferAttribute<"vec4">(life, "vec4");
  material.colorNode = Fn(() => {
    const q0 = uv()
      .sub(0.5)
      .mul(2 * STAR_REACH)
      .toVar();
    const c = cos(own.z);
    const s = sin(own.z);
    const q = vec2(q0.x.mul(c).add(q0.y.mul(s)), q0.y.mul(c).sub(q0.x.mul(s))).toVar();
    const aa = fwidth(q.x).mul(0.8).toVar();
    const reach = now.y;
    const hub = own.w;
    const waist = mix(float(0.05), float(0.034), hub);
    const long = spike(q.y, q.x, reach, waist, aa);
    const cross = spike(q.x, q.y, reach.mul(own.y), waist.mul(0.85), aa);
    const d = vec2(q.x.add(q.y), q.y.sub(q.x)).mul(Math.SQRT1_2);
    const diagonal = spike(d.x, d.y, reach.mul(0.16), waist.mul(0.5), aa).add(
      spike(d.y, d.x, reach.mul(0.16), waist.mul(0.5), aa),
    );
    const r = length(q);
    const core = exp(r.div(waist.mul(1.15)).pow(2).negate());
    // The hub's needles: hairlines running on past its tips to the quad's edge.
    const needle = hub
      .mul(
        exp(abs(q.x).div(aa.mul(1.2)).negate()).mul(
          float(1).sub(abs(q.y).div(STAR_REACH)).max(0).pow(2),
        ),
      )
      .add(
        hub.mul(
          exp(abs(q.y).div(aa.mul(1.2)).negate())
            .mul(float(1).sub(abs(q.x).div(STAR_REACH)).max(0).pow(2))
            .mul(own.y),
        ),
      )
      .mul(0.35);
    const halo = exp(r.div(mix(float(0.16), float(0.12), hub)).negate()).mul(
      mix(float(0.1), float(0.05), hub),
    );
    const body = long.add(cross).add(diagonal.mul(0.55)).add(needle).toVar();
    const tone = toneOf(own.x, NIGHT_TONES);
    const night = tone
      .mul(body.add(halo))
      .add(vec3(1, 0.98, 0.94).mul(core.mul(mix(float(2.2), float(1.3), hub))))
      .mul(now.x)
      // A star fades out at its quad's edge, so no square ever shows.
      .mul(smoothstep(float(STAR_REACH), float(STAR_REACH * 0.8), max(abs(q.x), abs(q.y))));
    const ink = toneOf(own.x, DAY_TONES);
    const cover = body.add(core.mul(0.6)).mul(now.x.min(1.4)).min(1);
    const day = grounds.paint(ink);
    return vec4(mix(day, night, u.dark), mix(cover, float(1), u.dark));
  })();
  return material;
}

/** Light or ink: how stars blend over what is behind them. */
export function setStarBlending(material: MeshBasicNodeMaterial, dark: boolean) {
  const blending = dark ? AdditiveBlending : NormalBlending;
  if (material.blending === blending) return;
  material.blending = blending;
  material.needsUpdate = true;
}

/** A small four-point glint in the sky at `off` from its centre: its long spike `size` frame units. */
function glintAt(off: V2, size: F, px: F): F {
  const aa = px.mul(0.7);
  const waist = size.mul(0.06).max(px.mul(0.45));
  return spike(off.y, off.x, size, waist, aa)
    .add(spike(off.x, off.y, size.mul(0.58), waist.mul(0.8), aa))
    .add(exp(length(off).div(px.mul(1.1)).pow(2).negate()).mul(1.4));
}

/** Distance from `p` to the segment `a`–`b`, and how far along it (0–1). */
function segment(p: V2, a: V2, b: V2): readonly [F, F] {
  const ab = b.sub(a);
  const t = clamp(dot(p.sub(a), ab).div(dot(ab, ab).max(1e-6)), 0, 1);
  return [length(p.sub(a.add(ab.mul(t)))), t];
}

/** Tiny stars, one to a cell, each breathing on its own clock. */
function tinyStars(p: V2, px: F, t: F): F {
  const id = floor(p.div(0.028));
  const h = hash2(id.add(3.7));
  const at = id.add(h.mul(0.7).add(0.15)).mul(0.028);
  const bright = pow(hash(id.add(11.3)), 7)
    .mul(0.9)
    .add(hash(id.add(1.9)).mul(0.06));
  const breathe = sin(t.mul(hash(id.add(5.1)).mul(1.5).add(0.4)).add(h.x.mul(6.283)))
    .mul(0.25)
    .add(0.75);
  return exp(length(p.sub(at)).div(px.mul(0.85)).pow(2).negate())
    .mul(bright)
    .mul(breathe);
}

/** Four-point glints, a few to a broad cell, lengthening and brightening near the pointer. */
function glintField(u: AstralUniforms, p: V2, px: F, t: F): F {
  const glints = float(0).toVar();
  const cell = 0.22;
  // A glint reaches less than half a cell, so the four cells nearest the pixel hold every one that reaches it.
  const home = floor(p.div(cell).sub(0.5));
  for (let i = 0; i <= 1; i++) {
    for (let j = 0; j <= 1; j++) {
      const gid = home.add(vec2(i, j));
      const g = hash2(gid.add(17.1));
      const centre = gid.add(g.mul(0.5).add(0.25)).mul(cell);
      const shows = step(hash(gid.add(29.3)), 0.42);
      const toward = centre.sub(u.pointer.xy);
      const near = exp(dot(toward, toward).div(0.012).negate()).mul(u.pointer.z);
      const size = mix(float(0.006), float(0.026), pow(hash(gid.add(41.7)), 2.2)).mul(
        near.mul(1.3).add(1),
      );
      const own = sin(t.mul(mix(float(0.15), float(0.5), g.y)).add(g.x.mul(6.283)))
        .mul(0.3)
        .add(0.7);
      glints.addAssign(
        glintAt(p.sub(centre), size, px).mul(shows).mul(own).mul(near.mul(1.4).add(0.55)),
      );
    }
  }
  return glints;
}

/** The constellation drawing itself: its stars appearing, then the dotted hairlines between them. */
function constellationAt(u: AstralUniforms, p: V2, px: F): F {
  const drawn = float(0).toVar();
  for (let i = 0; i < CONSTELLATION_POINTS; i++) {
    const pt = u.points.element(i);
    drawn.addAssign(glintAt(p.sub(pt.xy), pt.z.mul(pt.w), px).mul(pt.w));
    if (i === 0) continue;
    const prev = u.points.element(i - 1);
    const [dist, along] = segment(p, prev.xy, pt.xy);
    const span = length(pt.xy.sub(prev.xy));
    const dots = step(fract(along.mul(span).div(0.011)), 0.55);
    const grown = step(
      along,
      u.lines
        .mul(CONSTELLATION_POINTS - 1)
        .sub(i - 1)
        .clamp(0, 1),
    );
    drawn.addAssign(
      exp(dist.div(px.mul(0.6)).pow(2).negate())
        .mul(dots)
        .mul(grown)
        .mul(min(prev.w, pt.w))
        .mul(0.32),
    );
  }
  return drawn;
}

/** A shooting star: a fine streak behind its head, in and out over its life. */
function shootingStar(u: AstralUniforms, p: V2, px: F): F {
  const shot = u.shooting;
  const heading = vec2(cos(shot.z), sin(shot.z));
  const q = p.sub(shot.xy);
  const ahead = dot(q, heading);
  const aside = dot(q, vec2(heading.y.negate(), heading.x));
  const seen = sin(shot.w.mul(Math.PI)).max(0).pow(0.7).mul(step(0.0001, shot.w));
  const tail = exp(ahead.div(0.06))
    .mul(step(ahead, 0))
    .mul(smoothstep(-0.26, -0.02, ahead));
  return exp(aside.div(px.mul(0.9)).pow(2).negate())
    .mul(tail)
    .add(exp(length(q).div(px.mul(2.2)).pow(2).negate()).mul(1.6))
    .mul(seen);
}

/** Light shafts from the upper left across the instrument, and the dust drifting through them. */
function shaftsAt(u: AstralUniforms, p: V2, px: F, t: F): { readonly shaft: F; readonly mote: F } {
  const hero = u.hero.xy;
  const across = dot(p.sub(hero.add(vec2(-0.5, 0.6))), vec2(0.91, 0.42));
  const shaft = exp(across.div(0.09).pow(2).negate())
    .add(exp(across.sub(0.27).div(0.05).pow(2).negate()).mul(0.7))
    .mul(smoothstep(1.4, 0.2, length(p.sub(hero))))
    .mul(u.shafts)
    .toVar();
  const sway = vec2(gnoise(vec2(t.mul(0.05), 1.3)).mul(0.02), 0);
  const drift = p.add(vec2(t.mul(0.004), t.mul(-0.007)).add(sway));
  const id = floor(drift.div(0.05));
  const m = hash2(id.add(7.7));
  const at = id.add(m.mul(0.8).add(0.1)).mul(0.05);
  const twinkle = sin(t.mul(0.8).add(m.x.mul(30)))
    .mul(0.4)
    .add(0.6);
  const mote = exp(length(drift.sub(at)).div(px.mul(1.2)).pow(2).negate())
    .mul(step(hash(id.add(2.2)), 0.35))
    .mul(twinkle)
    .mul(shaft)
    .mul(smoothstep(0.55, 0.8, u.detail));
  return { shaft, mote };
}

/**
 * The sky's slow fields, drawn offscreen at a share of the frame's pixels a
 * few times a second (`offscreenPass`), since they change over minutes: the
 * nebula and the warmth about the hub on a dark page (x, y), the paper's
 * fibre on a light one (z).
 */
export function slowSky(u: AstralUniforms): TslNode<"vec4"> {
  return Fn(() => {
    const p = frameAt().toVar();
    const t = u.time;
    const nebula = fbm4(p.mul(1.3).add(vec2(t.mul(0.003), 4.1)));
    const warm = gnoise(p.mul(3.1).add(vec2(7.3, t.mul(-0.004))));
    const fibre = gnoise(p.mul(vec2(46, 4)).add(3.3))
      .sub(0.5)
      .mul(0.02)
      .add(fbm4(p.mul(7)).sub(0.5).mul(0.035));
    return vec4(nebula, warm, fibre, 1);
  })();
}

/** The sky, for `scene.backgroundNode`. Only the page's look is drawn, and a rare event only while it is under way. */
export function astralSky(
  u: AstralUniforms,
  { scrim, slow }: { readonly scrim: ReturnType<typeof textScrim>; readonly slow: PictureSampler },
  { ground, page, paint }: Grounds,
): V3 {
  return Fn(() => {
    const p = frameAt().toVar();
    const field = slow(vec2(screenUV.x, float(1).sub(screenUV.y))).toVar();
    const px = float(1).div(screenSize.y).toVar();
    const off = p.sub(u.hero.xy).div(u.hero.z.max(0.3));
    const d2 = dot(off, off).toVar();
    const under = scrim.under(vec2(screenUV.x, float(1).sub(screenUV.y)));
    const open = float(1).sub(under.mul(0.75)).toVar();
    const t = u.time;
    // The instrument's shadow on the sky: the ground of a dark page, the paper of a light one.
    const lit = contact(u, p).toVar();
    const tiny = tinyStars(p, px, t).toVar();
    // The glints are the detail a slow frame gives up first.
    const glints = float(0).toVar();
    If(u.detail.greaterThan(0.72), () => {
      glints.assign(glintField(u, p, px, t));
    });
    const drawn = float(0).toVar();
    If(u.lines.add(u.points.element(0).w).greaterThan(0), () => {
      drawn.assign(constellationAt(u, p, px));
    });
    const streak = float(0).toVar();
    If(u.shooting.w.greaterThan(0), () => {
      streak.assign(shootingStar(u, p, px));
    });
    const { shaft, mote } = shaftsAt(u, p, px, t);
    const shown = vec3(0, 0, 0).toVar();

    If(u.dark.greaterThan(0.5), () => {
      // Dark: ink-navy pooled about the instrument, a slow nebula, the champagne warmth at its hub.
      const nebula = field.x;
      const warm = field.y;
      const hub = vec3(0.05, 0.038, 0.018)
        .mul(exp(d2.div(-0.06)))
        .mul(u.flare.mul(1.5).add(1));
      const glow = smoothstep(0.45, 0.85, warm.mul(0.5).add(nebula.mul(0.5))).mul(
        exp(d2.div(-0.7)),
      );
      const sky = NAVY.mul(exp(d2.div(-1.8)).mul(0.9).add(0.45))
        .add(vec3(0.012, 0.016, 0.042).mul(smoothstep(0.42, 0.85, nebula)))
        .add(vec3(0.018, 0.012, 0.005).mul(glow))
        .add(hub)
        .add(vec3(0.05, 0.042, 0.03).mul(shaft.mul(0.22)));
      const lights = vec3(0.78, 0.82, 0.92)
        .mul(tiny)
        .add(vec3(0.86, 0.82, 0.74).mul(glints.mul(0.9)))
        .add(vec3(0.95, 0.82, 0.58).mul(drawn))
        .add(vec3(0.95, 0.92, 0.86).mul(streak))
        .add(vec3(1, 0.9, 0.72).mul(mote.mul(0.9)))
        .mul(open);
      shown.assign(ground.add(sky.add(lights).mul(lit.mul(0.65).add(0.35))));
    }).Else(() => {
      // Light: warm paper, its fibres, light pooled at the instrument; printed specks and marks; the cast shadow.
      const fibre = field.z;
      const pooled = exp(d2.div(-2.4)).mul(0.035).sub(0.02);
      const shade = float(1).add(fibre).add(pooled).add(shaft.mul(0.03)).mul(lit.mul(0.2).add(0.8));
      const ink = tiny.mul(0.8).add(glints.mul(0.7)).add(drawn.mul(0.9)).mul(open).min(0.9);
      const paper = page.mul(vec3(1, 0.99, 0.965)).mul(shade);
      const inked = mix(paper, INK.mul(1.6), ink);
      const gilded = mix(inked, GILT, streak.min(1).mul(0.85)).add(GILT.mul(mote.mul(0.4)));
      shown.assign(paint(gilded));
    });
    return shown;
  })();
}
