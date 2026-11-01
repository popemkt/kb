/**
 * Astral's shading (T1): the parts, the needle stars and the sky behind
 * them, each with its dark look and its light one in the same shader,
 * chosen by `dark`. The look is a luminous technical drawing moving in 3D:
 * real solids, cel-shaded, drawn in hairlines.
 *
 * - **Parts** (`partMaterial`), cel-shaded: no reflections, no sheen.
 *   A face is flat colour in a few bands, decided by the key: a lit
 *   crescent toward it, a shade away from it, and a darker band when the
 *   face turns from it; each band's edge is crisp, antialiased by its own
 *   footprint. Its edges are inked from the outline the solid was cut from
 *   (`Outline`, `astral-geometry.ts`), measured in pixels, so a line is a
 *   hairline (`hair`) at any size and angle; the turned rings in a
 *   wheel's face and what is cut into it (guilloché, scales, rings, a star
 *   chart, côtes, a hairspring) are inked the same. The walls are the ink
 *   lit or shaded by their turn to the key. A glint sweeps the lines now
 *   and then (`sweep`). A part's depth behind the hero's plane is its
 *   haze, read per pixel from where it stands: the far halves of rings and
 *   orbits and the trains behind are drawn finer, cooler and dimmer, and
 *   sink into the sky (the stage's depth of field softens them too).
 * - **On a dark page** the ink is light on navy plates: champagne,
 *   silver, gilt, ice for blued steel. **On paper** it is ink and gilt on
 *   the page, a face washed in its metal, its shade band hatched.
 * - **Stars** (`starMaterial`): one instanced quad each, facing the eye,
 *   their light in layers as the concept pictures draw it (`starLight`):
 *   a hard white core; two crisp needle tapers crossed, the long one
 *   upright, white at the heart; a soft bloom along them; a tight inner
 *   halo and a faint wide outer one, ice about the hub; the hub's short
 *   diagonals and hairline needles. HDR at the core only, so the frame's
 *   bloom takes a little and never washes. Brightness and spike length
 *   are per-star and per-frame (`life`): breathing, a glint where the
 *   pointer is near, the hub's flare at an event.
 * - **The sky** is `astral-sky.ts`.
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
import type { TslNode } from "@kb/scene-gpu";
import type { Grounds } from "../gpu/gpu-scene";
import {
  CONSTELLATION_LINKS,
  CONSTELLATION_POINTS,
  type Engraving,
  type Metal,
  type StarTone,
} from "./astral";
import { TOOTH, type WheelLayout } from "./astral-geometry";

export type F = TslNode<"float">;
export type V2 = TslNode<"vec2">;
export type V3 = TslNode<"vec3">;
type V4 = TslNode<"vec4">;

/** How many front discs darken what lies behind them. */
export const SHADOWS = 8;
/** A star's quad reaches this far past its long spike's tip, for its glint and its needles. */
export const STAR_REACH = 1.9;

/**
 * A constellation in the sky, as the shader reads it (frame units): each
 * star x y, its long spike and how far it has appeared; each link from x y
 * to x y, as far as it has drawn (a link not yet drawn has no length); how
 * strongly the links show; and the box it all lies in, so a pixel outside
 * it pays nothing.
 */
function figureUniforms() {
  const stars = Array.from({ length: CONSTELLATION_POINTS }, () => new Vector4());
  const links = Array.from({ length: CONSTELLATION_LINKS }, () => new Vector4());
  return {
    stars,
    links,
    starArray: uniformArray<"vec4">(stars, "vec4"),
    linkArray: uniformArray<"vec4">(links, "vec4"),
    shown: uniform(0),
    bounds: uniform(new Vector4(0, 0, 0, 0)),
  };
}
export type FigureUniforms = ReturnType<typeof figureUniforms>;

/** Everything the CPU sets, shared by the sky, the metal and the stars. */
export function astralUniforms() {
  const shadows = Array.from({ length: SHADOWS }, () => new Vector4());
  return {
    dark: uniform(1),
    time: uniform(0),
    /** The key (view space): high at the upper left, swung a little toward the pointer. */
    key: uniform(new Vector3(-0.55, 0.62, 0.55).normalize()),
    /** The night the dark sky pools to about the instrument, and the light its hub glows with (linear): the composition's (`Mechanism.sky`). */
    night: uniform(new Vector3(...NIGHT)),
    glow: uniform(new Vector3(...GLOW)),
    /** A hairline's width in device pixels: the ink's, the same in CSS pixels at any pixel ratio. */
    hair: uniform(1),
    /** The sky's graduated great circle: its centre and radius (frame units), and its tick pitch (radians). */
    arc: uniform(new Vector4(0, 0, 0, 0)),
    /** The glint sweeping the metal: where across the view (frame units), and how strong. */
    sweep: uniform(new Vector3(-9, 0, 0)),
    /** How far the hero's plane lies from the eye (world units): where the haze begins. */
    eye: uniform(4),
    /** The hub's flare at an event, 0–1. */
    flare: uniform(0),
    /** The instrument's centre (frame units), its scale, and its unit (frame units): how far the hub's light reaches. */
    hero: uniform(new Vector4(0, 0, 1, 0.33)),
    /** The pointer (frame units) and how near it is, 0–1. */
    pointer: uniform(new Vector3(0, 0, 0)),
    /** A shooting star: its head (frame units), its heading, and its life (0 none, 0–1 under way). */
    shooting: uniform(new Vector4(0, 0, 0, 0)),
    /** The composition's constellation, far behind (`Mechanism.constellation`). */
    figure: figureUniforms(),
    /** A constellation drawing itself, as a rare event. */
    forming: figureUniforms(),
    /** On paper: each disc casting a shadow, x y r strength (frame units). */
    casts: shadows,
    shadows: uniformArray<"vec4">(shadows, "vec4"),
    /** The detail the sky spends, 0–1 (`BackdropLayout.quality`). */
    detail: uniform(1),
  };
}
export type AstralUniforms = ReturnType<typeof astralUniforms>;

/** Where the key rests (view space): high at the upper left. Its turn decides a part's light bands. */
export const KEY_REST = new Vector3(-0.55, 0.62, 0.55).normalize();

type Rgb = readonly [number, number, number];

/** On a dark page (linear): each metal's ink, the light its edges and cuts are drawn in. */
const LINES: Readonly<Record<Metal, Rgb>> = {
  plate: [0.8, 0.72, 0.55],
  champagne: [0.62, 0.57, 0.47],
  silver: [0.4, 0.46, 0.58],
  gilt: [0.95, 0.66, 0.28],
  blued: [0.36, 0.6, 1.0],
};
/** On a dark page: each metal's plate, the flat fill between its lines (its middle band). */
const FILLS: Readonly<Record<Metal, Rgb>> = {
  plate: [0.006, 0.011, 0.03],
  champagne: [0.005, 0.009, 0.024],
  silver: [0.004, 0.008, 0.022],
  gilt: [0.03, 0.018, 0.006],
  blued: [0.006, 0.016, 0.06],
};
/** On paper: each metal's ink, and the wash of colour its face takes on the page. */
const INKS: Readonly<Record<Metal, Rgb>> = {
  plate: [0.011, 0.014, 0.03],
  champagne: [0.011, 0.014, 0.03],
  silver: [0.06, 0.066, 0.08],
  gilt: [0.3, 0.16, 0.035],
  blued: [0.024, 0.072, 0.19],
};
const WASHES: Readonly<Record<Metal, readonly [Rgb, number]>> = {
  plate: [[1, 0.985, 0.95], 0.08],
  champagne: [[0.37, 0.2, 0.045], 0.05],
  silver: [[0.12, 0.13, 0.15], 0.04],
  gilt: [[0.55, 0.36, 0.11], 0.5],
  blued: [[0.024, 0.072, 0.19], 0.2],
};
/** The ink and the gilt of the paper look (linear). */
export const INK = vec3(0.011, 0.014, 0.03);
export const GILT = vec3(0.37, 0.2, 0.045);
/** The dark sky a composition has unless it names its own (`Mechanism.sky`): ink-navy, a champagne warmth at the hub. */
export const NIGHT: Rgb = [0.006, 0.012, 0.034];
export const GLOW: Rgb = [0.05, 0.038, 0.018];
/** The hub star's light on the plates about it, a step (linear). */
const HUB_LIGHT = vec3(0.006, 0.011, 0.026);
/** How far behind the hero's plane the haze begins (instrument units): a front part's tilt stays clear. */
const SHARP = 0.08;
/** The steel blue a far part's ink cools to on a dark page. */
const STEEL = vec3(0.16, 0.22, 0.36);

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

/** One cut pattern: how much of a pixel is cut, and how strong its line is. */
interface Cut {
  readonly cover: F;
  readonly weight: number;
}

/** The pattern an engraving cuts, at `p` (face units), radius `r`, angle `a`. */
function engrave(e: Engraving, p: V2, r: F, a: F): Cut {
  switch (e.kind) {
    case "rings": {
      let cover: F = float(0);
      for (const radius of e.radii) cover = cover.max(cut(r.sub(radius), 0.0042));
      return { cover, weight: 0.65 };
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
        weight: 0.2,
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
      const width = mix(float(0.0022), float(0.004), major);
      const aa = fwidth(d).max(1e-5);
      const half = max(aa.mul(0.6), width.div(2));
      const line = smoothstep(half.add(aa.mul(0.5)), half.sub(aa.mul(0.5)), abs(d)).mul(
        min(float(1), width.div(half.mul(2))),
      );
      return { cover: line.mul(inBand), weight: 0.95 };
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
      return { cover, weight: 0.6 };
    }
    case "cotes": {
      const d = fract(p.x.mul(26).add(0.5)).sub(0.5).div(26);
      return { cover: cut(d, 0.0022), weight: 0.16 };
    }
    case "spiral": {
      // Archimedes: radius rises one pitch a turn, so the distance to the nearest coil is periodic.
      const pitch = (e.to - e.from) / e.coils;
      const turn = a.div(Math.PI * 2).add(0.5);
      const q = r.sub(e.from).div(pitch).sub(turn);
      const d = fract(q.add(0.5)).sub(0.5).mul(pitch);
      return { cover: cut(d, 0.0034).mul(band(r, e.from, e.to)), weight: 0.55 };
    }
    default:
      return e satisfies never;
  }
}

/**
 * A part's outline, the one its solid is cut from (`astral-geometry.ts`):
 * the shader inks the face's edge from it. A rod has no face; it is all edge.
 */
export type Outline =
  | { readonly kind: "wheel"; readonly layout: WheelLayout }
  | {
      readonly kind: "arm";
      readonly profile: readonly (readonly [number, number])[];
    }
  | { readonly kind: "rod" };

/** What a part is cut and finished with, decided when its material is made. */
export interface PartFinish {
  readonly metal: Metal;
  readonly engravings: readonly Engraving[];
  readonly outline: Outline;
  /** It lies behind the instrument's front parts, in their shadow (`contact`). */
  readonly behind: boolean;
}

/** Where a pixel lies in the frame (frame units: height 1, centre 0, y up). */
export const frameAt = (): V2 =>
  vec2(screenUV.x.sub(0.5).mul(screenSize.x.div(screenSize.y)), float(0.5).sub(screenUV.y));

/**
 * How much light the instrument's front parts leave at `p`: each casts a
 * soft disc of shadow down and to the right of it (`shadows`), on the sky
 * and on the wheels behind it.
 */
export function contact(u: AstralUniforms, p: V2): F {
  const lit = float(1).toVar();
  for (let i = 0; i < SHADOWS; i++) {
    const disc = u.shadows.element(i);
    const soft = disc.z.mul(0.09).add(0.012);
    const d = length(p.sub(disc.xy)).toVar();
    // Shaded only inside a disc's reach: most of the frame lies in none.
    If(disc.w.greaterThan(0).and(d.lessThan(disc.z.add(soft))), () => {
      const cover = smoothstep(disc.z.add(soft), disc.z.sub(soft.mul(0.6)), d).mul(disc.w);
      lit.mulAssign(float(1).sub(cover));
    });
  }
  return lit;
}

/** `g` (face units, 0 on an edge) as device pixels, by its own footprint. */
const pixels = (g: F): F => g.div(fwidth(g).max(1e-6));

/** A cel step: 0 below `x` = 0, 1 above, antialiased across one pixel. */
const cel = (x: F): F => {
  const aa = fwidth(x).max(1e-5).mul(0.75);
  return smoothstep(aa.negate(), aa, x);
};

/** Pixels in from a wheel's edges (its teeth or rim, its windows, its bore), and its turned rings. */
function wheelEdges(l: WheelLayout, r: F, a: F): { readonly edge: F; readonly rings: F } {
  let outer: F;
  if (l.teeth > 0) {
    const f = fract(a.mul(l.teeth / (Math.PI * 2)));
    const up = f
      .sub(TOOTH.rise)
      .div(TOOTH.tip - TOOTH.rise)
      .clamp(0, 1);
    const down = float(TOOTH.root)
      .sub(f)
      .div(TOOTH.root - TOOTH.fall)
      .clamp(0, 1);
    outer = float(l.root)
      .add(min(up, down).mul(l.tip - l.root))
      .sub(r);
  } else outer = float(l.tip).sub(r);
  let edge = pixels(outer);
  if (l.inner > 0) edge = min(edge, pixels(r.sub(l.inner)));
  // Rings turned in the face: inside the teeth's roots, and the arbor's collar in the hub.
  const rings: number[] = [];
  if (l.teeth > 0) rings.push(l.root - Math.max(0.006, (l.root - l.rim) * 0.42));
  if (l.spokes > 0) {
    const pitch = (Math.PI * 2) / l.spokes;
    const nearest = floor(a.div(pitch).add(0.5)).mul(pitch);
    const inSpoke = float(l.spoke / 2).sub(r.mul(abs(sin(a.sub(nearest)))));
    // A window is the band between hub and rim outside the spokes: the face's edge is the window's.
    const window = max(max(float(l.hub).sub(r), r.sub(l.rim)), inSpoke);
    edge = min(edge, pixels(window));
    rings.push(l.hub * 0.55);
  }
  let ringed: F = float(0);
  for (const radius of rings) ringed = ringed.max(pixels(r.sub(radius)).abs());
  return { edge, rings: rings.length > 0 ? ringed : float(1e4) };
}

/** Pixels in from an arm's edges: its sides by its profile, its tail and its tip. */
function armEdges(profile: readonly (readonly [number, number])[], p: V2): F {
  const [first] = profile;
  const last = profile[profile.length - 1];
  if (first === undefined || last === undefined) return float(1e4);
  let half: F = float(first[1]);
  for (let i = 1; i < profile.length; i++) {
    const [x0, y0] = profile[i - 1] ?? first;
    const [x1, y1] = profile[i] ?? last;
    half = half.add(
      p.x
        .sub(x0)
        .div(x1 - x0)
        .clamp(0, 1)
        .mul(y1 - y0),
    );
  }
  return min(
    pixels(half.sub(abs(p.y))),
    min(pixels(p.x.sub(first[0])), pixels(float(last[0]).sub(p.x))),
  );
}

/** Ink of an edge `d` pixels away, a line `w` pixels wide: whole inside it, antialiased, fainter below a pixel. */
const inked = (d: F, w: F): F => w.add(0.5).sub(d).clamp(0, 1).mul(w.min(1));

/**
 * A part's material, cel-shaded: flat colour in a few light bands, its
 * edges and its cuts inked as hairlines. On a dark page the ink is light
 * (champagne, silver, ice) on navy plates; on a light one it is ink and
 * gilt on paper, a shade band hatched as an engraver would.
 */
export function partMaterial(
  u: AstralUniforms,
  grounds: Grounds,
  finish: PartFinish,
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.side = DoubleSide;
  const { outline } = finish;
  const line = vec3(...LINES[finish.metal]);
  const fill = vec3(...FILLS[finish.metal]);
  material.colorNode = Fn(() => {
    const n = normalize(normalViewGeometry).mul(faceDirection).toVar();
    const key = u.key;
    const p = positionLocal.xy;
    const radius = length(p).toVar();
    const angle = atan(p.y, p.x);
    // The face, and its edges in pixels; a rod is all edge.
    const face = outline.kind === "rod" ? float(0) : step(0.9, abs(normalGeometry.z));
    const edges =
      outline.kind === "wheel"
        ? wheelEdges(outline.layout, radius, angle)
        : {
            edge: outline.kind === "arm" ? armEdges(outline.profile, p) : float(1e4),
            rings: float(1e4),
          };
    // How far behind the hero's plane, in the instrument's units, and so how deep in the haze.
    // A front part's own tilt stays sharp: the haze begins a little behind the plane (`SHARP`).
    const behind = positionView.z.negate().sub(u.eye).div(u.hero.w.max(1e-3)).sub(SHARP).max(0);
    const haze = float(1)
      .sub(exp(behind.div(-0.5)))
      .mul(0.85)
      .toVar();
    // A far part is drawn finer: its depth shows in its line, not its size.
    const hair = u.hair.mul(float(1).sub(haze.mul(0.35)));
    // Print takes its edges a little heavier than light does.
    const edgeHair = hair.mul(mix(float(1.8), float(1), u.dark));
    const edgeInk = inked(edges.edge, edgeHair).max(inked(edges.rings, hair.mul(0.7)).mul(0.5));
    // The cuts, flat: the same ink as the edges, weighed by kind.
    let cuts: F = float(0);
    for (const e of finish.engravings) {
      const c = engrave(e, p, radius, angle);
      cuts = cuts.add(c.cover.mul(c.weight));
    }
    // Print takes its cuts heavier too: an engraver's ink holds where light thins out.
    const lines = edgeInk
      .max(cuts.mul(mix(float(1.8), float(1), u.dark)).min(1))
      .mul(face)
      .toVar();
    // The bands: the key across the face (a lit crescent toward it, a shade away), and the face's own turn to it.
    const across = modelViewMatrix.mul(vec4(1, 0, 0, 0)).xy;
    const up = modelViewMatrix.mul(vec4(0, 1, 0, 0)).xy;
    const toward = normalize(vec2(dot(key.xy, across), dot(key.xy, up)).add(1e-5));
    const extent = outline.kind === "wheel" ? outline.layout.tip : 1;
    const s = dot(p, toward).div(extent);
    const lit = cel(s.sub(0.32)).toVar();
    const shade = cel(s.negate().sub(0.5)).toVar();
    const turned = cel(dot(n, key).sub(0.12)).toVar();
    // Where on the view the glint sweeps: frame units across (the view is orthographic), leaning.
    const sweepAt = positionView.x.add(positionView.y.mul(0.35));
    const glint = step(abs(sweepAt.sub(u.sweep.x)), 0.05)
      .mul(u.sweep.y)
      .toVar();
    // A part behind the instrument lies in its front parts' shadow.
    const shaded = finish.behind ? contact(u, frameAt()).toVar() : float(1);
    const shown = vec3(0, 0, 0).toVar();
    If(u.dark.greaterThan(0.5), () => {
      // Dark: a navy plate in three bands, the edges and cuts in light, the walls lit or not.
      // Deep in the haze the ink cools to steel and dims, as a far part does in the concepts.
      const ink = mix(line, STEEL, haze.mul(2.5).min(1)).mul(float(1).sub(haze.mul(0.7)));
      // The hub star lights the plates about it in two steps, more at a flare.
      const fromHub = length(frameAt().sub(u.hero.xy)).div(u.hero.w.max(1e-3));
      const pool = cel(float(0.72).sub(fromHub))
        .add(cel(float(0.38).sub(fromHub)))
        .mul(u.flare.mul(0.6).add(1));
      const plate = fill
        .mul(mix(float(1), float(1.6), lit))
        .mul(mix(float(1), float(0.62), shade))
        .mul(mix(float(0.7), float(1), turned))
        .add(HUB_LIGHT.mul(pool).mul(face));
      const wall = ink.mul(mix(float(0.08), float(0.26), turned));
      const body = mix(wall, plate, face);
      const night = mix(body, ink.mul(glint.mul(0.6).add(0.8)), lines)
        .add(ink.mul(glint.mul(0.05)).mul(face))
        .mul(shaded.mul(0.5).add(0.5));
      shown.assign(
        mix(grounds.ground.add(night), grounds.ground.add(u.night.mul(1.2)), haze.mul(0.5)),
      );
    }).Else(() => {
      // Paper: the page in two bands, a shade band hatched, the edges and cuts in ink, the walls inked.
      const page = grounds.page;
      const [tint, wash] = WASHES[finish.metal];
      const paper = mix(page, vec3(...tint), wash)
        .mul(mix(float(0.965), float(1.025), lit))
        .mul(mix(float(1), float(0.965), shade.max(float(1).sub(turned))));
      const hatching = cut(
        fract(p.x.add(p.y).mul(1 / 0.016))
          .sub(0.5)
          .mul(0.016),
        0.0018,
      )
        .mul(shade.max(float(1).sub(turned)))
        .mul(0.4);
      const ink = INKS[finish.metal];
      const wall = mix(page, vec3(...ink), mix(float(0.45), float(0.25), turned));
      const body = mix(wall, paper, face);
      const drawn = mix(body, vec3(...ink), lines.max(hatching.mul(face)).min(1));
      shown.assign(grounds.paint(mix(drawn, page, haze.mul(0.7)).mul(shaded.mul(0.3).add(0.7))));
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

/**
 * One needle spike along `along`, `reach` long, from a star `waist` wide
 * (the concept pictures' polygon): a broad base that narrows fast within
 * a few waists of the centre, then a straight taper to the tip. Its edges
 * are box-filtered over a pixel (`aa`), so it is crisp at any width; its
 * light falls off toward the tip.
 */
export function spike(along: F, across: F, reach: F, waist: F, aa: F): F {
  const k = clamp(float(1).sub(abs(along).div(reach)), 0, 1);
  const base = float(1)
    .sub(abs(along).div(waist.mul(2.4)))
    .max(0);
  const half = waist.mul(k.mul(0.36).add(base.mul(0.64)));
  const a = abs(across);
  const cover = min(half, a.add(aa.mul(0.5)))
    .sub(max(half.negate(), a.sub(aa.mul(0.5))))
    .clamp(0, aa)
    .div(aa);
  return cover.mul(pow(k, 1.1));
}

/** The share of a star's own units a pixel spans at `q`. */
const footprint = (q: V2): F => fwidth(q.x).max(1e-5);

/** The soft light along a spike, `reach` long, in a star's own units. */
const spikeBloom = (along: F, across: F, reach: F): F =>
  exp(across.div(0.045).pow(2).negate()).mul(float(1).sub(abs(along).div(reach)).max(0).pow(1.5));

/**
 * A star's light in layers, as the concept pictures draw it (`q` in units
 * of its long spike, turned to its axes): a hard white `core`; the crisp
 * four-point `spikes`, white at the heart and their tone further out
 * (`white`, 0 white to 1 tone); a soft `bloom` along them; a tight inner
 * `halo` and a faint wide outer one, ice about the hub; and the hub's
 * hairline needles running on to the quad's edge, counted in `spikes`.
 */
function starLight(q: V2, own: V4, reach: F, px: F) {
  const hub = own.w;
  const waist = mix(float(0.06), float(0.042), hub);
  const long = spike(q.y, q.x, reach, waist, px);
  const cross = spike(q.x, q.y, reach.mul(own.y), waist, px);
  const d = vec2(q.x.add(q.y), q.y.sub(q.x)).mul(Math.SQRT1_2);
  const diagonal = spike(d.x, d.y, reach.mul(0.16), waist.mul(0.8), px)
    .add(spike(d.y, d.x, reach.mul(0.16), waist.mul(0.8), px))
    .mul(hub);
  const needle = exp(abs(q.x).div(px.mul(1.2)).negate())
    .mul(float(1).sub(abs(q.y).div(STAR_REACH)).max(0).pow(2))
    .add(
      exp(abs(q.y).div(px.mul(1.2)).negate())
        .mul(float(1).sub(abs(q.x).div(STAR_REACH)).max(0).pow(2))
        .mul(own.y),
    )
    .mul(hub.mul(0.35));
  const bloom = spikeBloom(q.y, q.x, reach)
    .add(spikeBloom(q.x, q.y, reach.mul(own.y)))
    .mul(mix(float(0.1), float(0.22), hub));
  const r = length(q).toVar();
  const R = mix(float(0.12), float(0.085), hub).max(px.mul(1.5));
  const glow = mix(float(0.6), float(0.9), hub);
  return {
    core: smoothstep(R, R.mul(0.45), r),
    spikes: long.add(cross).add(diagonal.mul(0.8)).add(needle),
    white: smoothstep(0.03, 0.25, r),
    bloom,
    halo: smoothstep(glow.mul(0.3), float(0), r)
      .mul(0.55)
      .add(float(1).sub(r.div(glow)).max(0).pow(2).mul(0.16)),
  };
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
    const { q, px } = starPixel(own);
    const night = vec3(0, 0, 0).toVar();
    const cover = float(0).toVar();
    If(lights(q), () => {
      const light = starLight(q, own, now.y, px);
      const tone = toneOf(own.x, NIGHT_TONES);
      const haloTone = mix(tone, vec3(...NIGHT_TONES.ice), own.w);
      night.assign(
        mix(vec3(1, 0.98, 0.95), tone, light.white)
          .mul(light.spikes.mul(1.3))
          .add(tone.mul(light.bloom))
          .add(haloTone.mul(light.halo))
          .add(vec3(1, 0.99, 0.97).mul(light.core.mul(2.6)))
          .mul(now.x)
          // A star fades out at its quad's edge, so no square ever shows.
          .mul(smoothstep(float(STAR_REACH), float(STAR_REACH * 0.8), max(abs(q.x), abs(q.y)))),
      );
      // On paper a star is printed: its spikes and its core in solid ink, no glow.
      cover.assign(starCover(light, now));
    });
    const day = grounds.paint(toneOf(own.x, DAY_TONES));
    return vec4(mix(day, night, u.dark), mix(cover, float(1), u.dark));
  })();
  return material;
}

/**
 * Where on its quad a star's pixel lies (`q`, turned to the star's angle),
 * and a pixel's width there, taken before any branch (a derivative needs
 * every pixel about it).
 */
function starPixel(own: TslNode<"vec4">) {
  const q0 = uv()
    .sub(0.5)
    .mul(2 * STAR_REACH)
    .toVar();
  const c = cos(own.z);
  const s = sin(own.z);
  const q = vec2(q0.x.mul(c).add(q0.y.mul(s)), q0.y.mul(c).sub(q0.x.mul(s))).toVar();
  return { q, px: footprint(q).toVar() };
}

/**
 * Whether a star has light at `q`: near its spikes' axes (their bloom
 * reaches a few hundredths across) or within its halo; the rest of its
 * quad is dark, and left unshaded.
 */
const lights = (q: V2) => min(abs(q.x), abs(q.y)).lessThan(0.15).or(length(q).lessThan(1));

/** How solidly a star covers its pixel: its spikes and its core, not its glow. */
const starCover = (light: ReturnType<typeof starLight>, now: TslNode<"vec4">): F =>
  light.spikes.add(light.core).min(1).mul(now.x.min(1));

/**
 * A star layer's depth, drawn where its spikes and core cover (no colour):
 * a star drawn over everything marks its own depth there, so the stage's
 * depth of field keeps it as sharp as its plane, never as what lies behind.
 */
export function starMark(
  shape: InstancedBufferAttribute,
  life: InstancedBufferAttribute,
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  // Among the transparent draws: after the sky, which the opaque ones end with.
  material.transparent = true;
  material.colorWrite = false;
  material.depthTest = false;
  material.depthWrite = true;
  material.alphaTest = 0.3;
  const own = instancedBufferAttribute<"vec4">(shape);
  const now = instancedDynamicBufferAttribute<"vec4">(life, "vec4");
  material.opacityNode = Fn(() => {
    const { q, px } = starPixel(own);
    const cover = float(0).toVar();
    If(lights(q), () => {
      cover.assign(starCover(starLight(q, own, now.y, px), now));
    });
    return cover;
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
