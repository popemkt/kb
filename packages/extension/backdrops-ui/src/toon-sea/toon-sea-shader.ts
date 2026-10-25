/**
 * The Toon sea backdrop's shaders (T1): an open sea in the modern anime-game
 * manner, lit in stepped tones with soft ramps, never flat fills.
 *
 * - **The sky** is drawn offscreen (`skyFragment`), at a share of the
 *   frame's pixels and every few frames: it is soft, it moves a pixel every
 *   few seconds, and the sea samples it as its mirror. A three-stop
 *   gradient; the sun (or the moon, with a terminator) with its bloom,
 *   halo and slow crepuscular rays; stars at night; high cirrus; a low far
 *   bank; and the hero cumulus, a smooth body crowned by a crowd of round
 *   puffs under an art-directed tower profile, shaded through three tones,
 *   creased where puffs meet, silver-lined toward the light and faded by
 *   atmospheric perspective. Towers are lower in a narrow frame, so a side
 *   panel crops the bank rather than squeezing each tower into a spike.
 * - **The sea** (`seaFrame`) is a perspective plane: five peaked waves
 *   filtered by their pixel footprint (the far sea never shimmers), a fine
 *   normal near us, body colour stepped by distance with wobbling band
 *   edges, a toon Fresnel mixing in the mirrored sky, subsurface light in
 *   the crests, crisp two-tone foam caps, thin anime wave lines, and the
 *   light's path as a banded sheen of four-point glints.
 * - **The owner**: ripple rings spread from where the pointer rests over the
 *   water; the owner's activity rolls splash rings out with bursts of
 *   glints, three taking turns on one clock (`splashes`), as bright as it
 *   is high; typing calms the swell.
 * - **Readability**: under the head's text block (`scrim`) the sea is
 *   quieter, a soft local contrast toward the text's opposite and no glints.
 * - **Dark** pages show the moonlit night with bioluminescent wakes,
 *   **light** pages the day, composed in the page's terms (`Grounds.paint`).
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
  float,
  fract,
  fwidth,
  length,
  max,
  min,
  mix,
  normalize,
  pow,
  reflect,
  screenUV,
  select,
  sin,
  smoothstep,
  sqrt,
  step,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { Vector2, Vector3, Vector4 } from "three/webgpu";
import type { OffscreenInputs, PictureSampler, TslNode } from "@kb/scene-gpu";
import type { Grounds } from "../gpu/gpu-scene";
import { darkGrade } from "../gpu/dark-grade";
import { textScrim } from "../gpu/text-scrim";
import { fbm4, hash, hash2, pnoise } from "../gpu/noise";

type F = TslNode<"float">;
type V2 = TslNode<"vec2">;
type V3 = TslNode<"vec3">;

/** How many splash rings take turns. */
export const SPLASHES = 3;

/** Everything the CPU sets: one set of uniforms both passes read. */
export function toonSeaUniforms() {
  return {
    time: uniform(30),
    dark: uniform(1),
    /** The horizon, as a share of the frame's height from its bottom. */
    horizon: uniform(0.6),
    /** The frame's width over its height. */
    aspect: uniform(2.75),
    /** The sun (or moon), as shares of the frame from its left and its bottom. */
    sun: uniform(new Vector2(0.74, 0.85)),
    /** Typing's calm, 0–1. */
    calm: uniform(0),
    /** Where the pointer rests (shares from left and bottom) and how near it is, 0–1. */
    pointer: uniform(new Vector3(0.5, 0.4, 0)),
    /** Each splash: where (shares from left and bottom), its age (s) and its energy. */
    splashes: Array.from({ length: SPLASHES }, () => uniform(new Vector4(0.5, 0.45, 99, 0))),
    /** Detail, 1 at full quality: the fine normal and the glints fall with it. */
    detail: uniform(1),
    /** The frame's size in CSS pixels. */
    size: uniform(new Vector2(1280, 360)),
    /** The head's text block, to keep the glints out from under it and lay a scrim there. */
    scrim: textScrim(),
  };
}
export type ToonSeaUniforms = ReturnType<typeof toonSeaUniforms>;

/** The sea's focal length: a world point (x, z) at height 0 shows at x/z·F across, 1/z·F below the horizon. */
const FOCAL = 1.15;
/** How fast the sea drifts toward us (world units a second). */
const DRIFT = 0.35;
/** Each wave: direction (rad), wavelength, amplitude, speed factor. */
const WAVES: readonly (readonly [number, number, number, number])[] = [
  [0.25, 12, 0.15, 1],
  [-0.4, 7.5, 0.09, 1],
  [0.9, 4.4, 0.05, 1.1],
  [-1.1, 2.6, 0.027, 1.2],
  [0.1, 1.5, 0.015, 1.3],
];

/** Gradient noise, 0–1: the periodic one, its period far beyond any coordinate the sea reaches. */
const gnoise = (p: V2): F => pnoise(p, 65536);

/** Turn and scale for the next octave (as `noise.ts`). */
const turn = (p: V2): V2 => vec2(p.x.mul(1.6).sub(p.y.mul(1.2)), p.x.mul(1.2).add(p.y.mul(1.6)));

/** Billowed noise: a softened |n|, so the creases round off. */
const billowFn = Fn(([start]: readonly [V2]) => {
  let p: V2 = start;
  let sum: F = float(0);
  let amplitude = 0.5;
  for (let i = 0; i < 4; i++) {
    const n = gnoise(p).mul(2).sub(1);
    sum = sum.add(sqrt(n.mul(n).add(0.004)).mul(amplitude));
    p = turn(p).add(3.1).toVar();
    amplitude *= 0.5;
  }
  return sum;
}).setLayout({ name: "kbToonBillow", type: "float", inputs: [{ name: "p", type: "vec2" }] });
const billow = (p: V2): F => billowFn(p);

const bump = (x: F, centre: F | number, width: number): F =>
  exp(x.sub(centre).div(width).pow(2).negate());

/**
 * The hero bank's tower profile at `x` (sky heights from the frame's left):
 * centres placed in shares of the frame, widths in sky heights, so a narrow
 * frame crops the bank instead of squeezing each tower; narrow frames get
 * lower towers.
 */
function puffTopOf(u: ToonSeaUniforms) {
  const fn = Fn(([x]: readonly [F]) => {
    const ar = u.aspect;
    const k = clamp(ar.div(2.4), 0.6, 1);
    const roll = gnoise(vec2(x.mul(1.3), 1.7))
      .mul(0.65)
      .add(gnoise(vec2(x.mul(2.9), 4.1)).mul(0.35));
    return k.mul(
      float(-0.03)
        .add(roll.mul(0.05))
        .add(bump(x, ar.mul(0.19), 0.3).mul(0.25))
        .add(bump(x, ar.mul(0.38), 0.17).mul(0.14))
        .add(bump(x, ar.mul(0.57), 0.09).mul(0.05))
        .add(bump(x, ar.mul(0.97), 0.24).mul(0.21)),
    );
  }).setLayout({ name: "kbToonPuffTop", type: "float", inputs: [{ name: "x", type: "float" }] });
  return (x: F): F => fn(x);
}

/** The palette, per mood. */
function palette(u: ToonSeaUniforms) {
  const pick = (day: readonly [number, number, number], night: readonly [number, number, number]) =>
    mix(vec3(...day), vec3(...night), u.dark);
  return {
    zenith: pick([0.035, 0.2, 0.62], [0.004, 0.007, 0.03]),
    mid: pick([0.16, 0.46, 0.92], [0.012, 0.02, 0.075]),
    horizon: pick([0.62, 0.84, 1], [0.05, 0.07, 0.16]),
    sun: pick([1, 0.9, 0.72], [0.8, 0.88, 1]),
    foam: pick([1.05, 1.06, 1.08], [0.32, 0.42, 0.62]),
    /** A value by mood: `day` on a light page, `night` on a dark one. */
    byMood: (day: number, night: number): F => mix(float(day), float(night), u.dark),
    pick,
  };
}

/** A step at `edge`, antialiased over the pixel. */
function aastep(edge: F | number, x: F): F {
  const e = typeof edge === "number" ? float(edge) : edge;
  const w = fwidth(x).mul(0.75).add(1e-5);
  return smoothstep(e.sub(w), e.add(w), x);
}

type Palette = ReturnType<typeof palette>;

/** The sky's place: uv from the frame's left and bottom, the sky's own coordinates, and the light's. */
interface SkyAt {
  readonly at: V2;
  /** Height above the horizon. */
  readonly y: F;
  /** Height above the horizon over the sky's height, 0–1. */
  readonly yy: F;
  /** In sky heights from the frame's bottom left. */
  readonly sp: V2;
  readonly sunS: V2;
  /** Distance to the light. */
  readonly sd: F;
  /** The pass's size in pixels. */
  readonly size: V2;
}

/** The air: a three-stop gradient, the light's bloom, halo and slow rays, and stars at night. */
function skyAir(u: ToonSeaUniforms, pal: Palette, { y, yy, sp, sunS, sd }: SkyAt): V3 {
  const t = u.time;
  const col = mix(pal.horizon, pal.mid, smoothstep(0, 0.5, yy)).toVar();
  col.assign(mix(col, pal.zenith, smoothstep(0.35, 1.05, yy)));
  // A warm (or cool) bloom in the air around the light, then its halo.
  col.addAssign(
    pal.sun.mul(
      exp(sd.mul(-4.5))
        .mul(pal.byMood(0.32, 0.18))
        .add(exp(sd.mul(-14)).mul(pal.byMood(0.9, 0.3))),
    ),
  );
  col.addAssign(
    pal.sun.mul(pal.byMood(0.05, 0.025)).mul(exp(sd.sub(0.2).div(0.012).pow(2).negate())),
  );
  // Stylised crepuscular rays: soft radial spokes that turn very slowly.
  const rd = sp.sub(sunS);
  const angle = atan(rd.y, rd.x);
  const rays = pow(
    sin(
      angle
        .mul(11)
        .add(t.mul(0.02))
        .add(sin(angle.mul(3).sub(t.mul(0.015))).mul(2)),
    )
      .mul(0.5)
      .add(0.5),
    6,
  )
    .mul(exp(sd.mul(-3.2)))
    .mul(smoothstep(0.03, 0.12, sd));
  col.addAssign(pal.sun.mul(rays.mul(pal.byMood(0.14, 0.02)).mul(step(0, y))));
  // Stars at night.
  const g = sp.mul(70);
  const id = g.floor();
  const f = g.fract().sub(0.5);
  const h = hash(id);
  const d = length(f.sub(hash2(id).sub(0.5).mul(0.6)));
  const twinkle = sin(t.mul(h.mul(3).add(1)).add(h.mul(60)))
    .mul(0.5)
    .add(0.5);
  col.addAssign(
    vec3(0.75, 0.82, 1).mul(
      exp(d.mul(d).mul(-260))
        .mul(twinkle)
        .mul(smoothstep(0.05, 0.35, yy))
        .mul(1.6)
        .mul(step(0.965, h))
        .mul(u.dark),
    ),
  );
  return col;
}

/** High cirrus, lit on the sun side, and the low far bank on the horizon, gently stepped. */
function skyBanks(u: ToonSeaUniforms, pal: Palette, air: V3, { at, y, sp }: SkyAt): V3 {
  const t = u.time;
  const cp = vec2(sp.x.mul(1.6).add(t.mul(0.003)), sp.y.mul(15).add(sin(sp.x.mul(2.3)).mul(0.6)));
  const cirrus = smoothstep(0.56, 0.8, fbm4(cp.add(vec2(fbm4(cp.mul(0.5)).mul(1.2), 0))))
    .mul(smoothstep(0.12, 0.3, y))
    .mul(smoothstep(0.95, 0.6, at.y));
  const col = mix(
    air,
    mix(air.mul(1.05), pal.sun.mul(1.1), 0.55),
    cirrus.mul(pal.byMood(0.45, 0.25)),
  );
  const bp = vec2(sp.x.mul(3).add(t.mul(0.002)), y.mul(6));
  const bank = float(0.025)
    .add(fbm4(vec2(bp.x.mul(0.8), 7)).mul(0.03))
    .sub(y)
    .mul(40)
    .add(
      billow(bp.mul(vec2(1.5, 3)))
        .sub(0.45)
        .mul(1.4),
    );
  const shown = smoothstep(0, 0.25, bank).mul(step(-0.004, y));
  const lit = smoothstep(0.35, 0.65, fbm4(bp.mul(vec2(1.2, 2)).add(2)));
  const tone = mix(
    pal.pick([0.62, 0.7, 0.92], [0.03, 0.04, 0.1]),
    pal.pick([1, 0.97, 0.94], [0.1, 0.12, 0.22]),
    lit,
  );
  return mix(col, mix(tone, pal.horizon, 0.35), shown.mul(0.9));
}

/** The puffs nearest `p`: the tallest (its height, radius, centre), the runner-up, and the coverage. */
interface Puffs {
  readonly best: F;
  readonly second: F;
  readonly bestR: F;
  readonly bestC: V2;
  /** The largest signed distance inside any puff: a linear edge, so the outline is clean. */
  readonly sdMax: F;
}

/** The crown's puffs round `p`: two cells each way, so none is clipped; the profile read once a column. */
function puffsAt(puffTop: (x: F) => F, p: V2, drift: F): Puffs {
  const cs = vec2(0.05, 0.042);
  const cell = p.div(cs).floor().toVar();
  const best = float(-1).toVar();
  const second = float(-1).toVar();
  const bestR = float(1).toVar();
  const bestC = vec2(0, 0).toVar();
  const sdMax = float(-1).toVar();
  for (let i = -2; i <= 2; i++) {
    const tp = puffTop(
      cell.x
        .add(i + 0.5)
        .mul(cs.x)
        .sub(drift),
    ).toVar();
    const big = smoothstep(0.02, 0.22, tp);
    for (let j = -2; j <= 2; j++) {
      const cid = cell.add(vec2(i, j));
      const c = cid
        .add(0.5)
        .add(hash2(cid.add(17)).sub(0.5).mul(vec2(0.5, 0.6)))
        .mul(cs);
      const r = mix(float(0.026), big.mul(0.03).add(0.048), pow(hash(cid.add(3.1)), 1.5));
      const placed = c.y
        .lessThanEqual(tp.sub(r.mul(0.45)))
        .and(c.y.greaterThanEqual(tp.sub(0.1)))
        .and(c.y.greaterThanEqual(0.006));
      const dd = p.sub(c);
      const q2 = r.mul(r).sub(dot(dd, dd));
      sdMax.assign(select(placed, max(sdMax, r.sub(length(dd))), sdMax));
      const hz = sqrt(max(q2, 0));
      const inside = placed.and(q2.greaterThan(0));
      If(inside.and(hz.greaterThan(best)), () => {
        second.assign(best);
        best.assign(hz);
        bestR.assign(r);
        bestC.assign(c);
      }).ElseIf(inside.and(hz.greaterThan(second)), () => {
        second.assign(hz);
      });
    }
  }
  return { best, second, bestR, bestC, sdMax };
}

/**
 * The hero cumulus over `col`: a smooth body whose crown is a crowd of round
 * puffs. Shading is coherent at the large scale (the crown faces the light,
 * the belly the shade, the flanks the profile's slope) and each puff only
 * bends that normal: three tones, soft creases, a silver lining, and
 * atmospheric perspective toward the horizon.
 */
function heroClouds(
  u: ToonSeaUniforms,
  pal: Palette,
  puffTop: (x: F) => F,
  col: V3,
  sky: SkyAt,
): void {
  const { y, sp, sunS, sd, size } = sky;
  const t = u.time;
  If(y.greaterThan(-0.01).and(y.lessThan(0.42)), () => {
    const drift = t.mul(0.0025);
    const p0 = vec2(sp.x.add(drift), y);
    const p = p0
      .add(
        vec2(gnoise(p0.mul(24).add(t.mul(0.05))), gnoise(p0.mul(24).add(7.3).sub(t.mul(0.05))))
          .sub(0.5)
          .mul(0.012),
      )
      .toVar();
    const xw = p.x.sub(drift);
    const top = puffTop(xw).toVar();
    const slope = puffTop(xw.add(0.01)).sub(top).div(0.01).toVar();
    const body = top.sub(0.045).sub(p.y).toVar();
    const { best, second, bestR, bestC, sdMax } = puffsAt(puffTop, p, drift);
    const cov = max(body, sdMax).toVar();
    If(cov.greaterThan(-0.01).and(top.greaterThan(0)), () => {
      const up = clamp(p.y.sub(top.mul(0.45)).div(top.mul(0.55).add(0.02)), -1, 1);
      const nBig = normalize(vec3(slope.mul(-0.5), up.mul(1.1), 0.85));
      const hasPuff = best.greaterThan(0);
      const n = select(
        hasPuff,
        normalize(nBig.mul(1.5).add(normalize(vec3(p.sub(bestC), best)))),
        nBig,
      );
      const crease = select(
        hasPuff.and(second.greaterThan(0)),
        exp(best.sub(second).negate().div(bestR.mul(0.06).add(0.004))).mul(0.18),
        float(0),
      );
      const toSun = normalize(sunS.sub(sp));
      const x = dot(n, normalize(vec3(toSun.mul(0.8), 0.6)))
        .sub(crease)
        .sub(smoothstep(0.07, 0, p.y).mul(0.35));
      // Not every pixel of a quad comes here, so the ramp's softness is a constant, a little over a pixel's.
      const fw = 0.035;
      const tone = mix(
        pal.pick([0.38, 0.44, 0.8], [0.022, 0.03, 0.075]),
        pal.pick([0.7, 0.76, 0.97], [0.05, 0.065, 0.14]),
        smoothstep(0.22 - fw, 0.22 + fw, x),
      ).toVar();
      tone.assign(
        mix(
          tone,
          pal.pick([1.05, 1.01, 0.96], [0.12, 0.14, 0.25]),
          smoothstep(0.52 - fw, 0.52 + fw, x),
        ),
      );
      // Silver lining on the outline, facing the light; brightest near it.
      const edge = float(1).sub(smoothstep(0, 0.01, cov));
      const outward = select(
        hasPuff.and(best.greaterThan(body)),
        normalize(p.sub(bestC)),
        normalize(vec2(slope.negate(), 1)),
      );
      const rim = edge
        .mul(smoothstep(0, 0.6, dot(outward, toSun)))
        .mul(exp(sd.mul(-2.2)).mul(1.5).add(0.4));
      tone.addAssign(pal.sun.mul(rim.mul(pal.byMood(1, 0.8))));
      tone.assign(mix(tone, pal.horizon, smoothstep(0.1, 0, y).mul(0.5)));
      const pixel = float(1).div(size.y);
      const shown = smoothstep(-0.0015, pixel.mul(1.2).add(0.0015), cov).mul(
        smoothstep(-0.002, 0.01, y),
      );
      col.assign(mix(col, tone, shown));
    });
  });
}

/** The light's disc: a hot core that blooms; the moon gets a terminator. */
function lightDisc(u: ToonSeaUniforms, pal: Palette, col: V3, { sp, sunS, sd, size }: SkyAt): V3 {
  const r = pal.byMood(0.036, 0.042);
  const px = float(1.5).div(size.y);
  const disc = float(1).sub(smoothstep(r.sub(px), r.add(px), sd));
  const m = length(sp.sub(sunS).sub(vec2(0.016, 0.008)));
  const moon = mix(0.12, 1, smoothstep(r.sub(0.004), r.add(0.006), m).mul(0.9).add(0.1)).mul(
    gnoise(sp.mul(60)).mul(0.15).add(0.85),
  );
  return mix(col, pal.sun.mul(mix(float(9), moon.mul(2.2), u.dark)), disc);
}

/** The offscreen pass: the sky over the whole frame, uv (0–1) from the frame's left and bottom. */
export function skyFragment(u: ToonSeaUniforms, { size }: OffscreenInputs): TslNode<"vec4"> {
  const puffTop = puffTopOf(u);
  return Fn(() => {
    const pal = palette(u);
    const at = uv();
    const y = at.y.sub(u.horizon).toVar();
    const sp = vec2(at.x.mul(u.aspect), at.y).toVar();
    const sunS = vec2(u.sun.x.mul(u.aspect), u.sun.y);
    const sky: SkyAt = {
      at,
      y,
      yy: max(y, 0).div(float(1).sub(u.horizon)),
      sp,
      sunS,
      sd: length(sp.sub(sunS)).toVar(),
      size,
    };
    const col = skyBanks(u, pal, skyAir(u, pal, sky), sky).toVar();
    heroClouds(u, pal, puffTop, col, sky);
    return vec4(lightDisc(u, pal, col, sky), 1);
  })();
}

/** A sea point's world position (x across, z away) for frame uv `at` below the horizon. */
function toWorld(u: ToonSeaUniforms, at: V2): V2 {
  const z = float(FOCAL).div(max(u.horizon.sub(at.y), 1e-4));
  return vec2(at.x.sub(0.5).mul(u.aspect).mul(z).div(FOCAL), z);
}

/** A ring of radius `radius` round `c`, `age` seconds old: its height and its slope. */
function ripple(wp: V2, c: V2, radius: F, age: F): { readonly height: F; readonly slope: V2 } {
  const r = wp.sub(c);
  const l = length(r).add(1e-4);
  const x = l.sub(radius);
  const envelope = exp(x.mul(x).mul(-3)).mul(exp(age.mul(-0.6)));
  return {
    height: sin(x.mul(7)).mul(envelope),
    slope: r.div(l).mul(cos(x.mul(7)).mul(7).mul(envelope)),
  };
}

/** A four-point star at offset `f` of sharpness `s`: a core and two spikes. */
function star(f: V2, s: number): F {
  const a = abs(f);
  return exp(length(f).mul(-s * 0.9)).add(
    exp(a.x.mul(-s * 3))
      .mul(exp(a.y.mul(-s * 0.45)))
      .add(exp(a.y.mul(-s * 3)).mul(exp(a.x.mul(-s * 0.45))))
      .mul(0.8),
  );
}

/** The swell at `wp`: five peaked waves filtered by the pixel's footprint `fp`, and the fine normal near us. */
function swell(u: ToonSeaUniforms, wp: V2, fp: F) {
  const t = u.time;
  const amp = float(1).sub(u.calm.mul(0.55));
  let h: F = float(0);
  let grad: V2 = vec2(0, 0);
  let crest: F = float(1);
  WAVES.forEach(([angle, wavelength, amplitude, speed], i) => {
    const dir = vec2(Math.sin(angle), Math.cos(angle));
    const k = (2 * Math.PI) / wavelength;
    const w = Math.sqrt(9.8 * k) * speed * 0.55;
    const filt = float(1).sub(smoothstep(0.15, 0.5, fp.mul(k)));
    const a = amp.mul(amplitude).mul(filt);
    const phase = dot(dir, wp).mul(k).sub(t.mul(w));
    const pk = sin(phase).mul(0.5).add(0.5);
    // A slightly peaked profile (crests sharper than troughs), the classic stylised swell.
    h = h.add(a.mul(pk.mul(pk).mul(2).sub(1)));
    grad = grad.add(dir.mul(a.mul(2).mul(pk).mul(cos(phase)).mul(k)));
    if (i < 3) crest = crest.mul(mix(float(1), pk.mul(pk), filt)); // where the big crests coincide
  });
  const near = float(1).sub(smoothstep(0.4, 2.5, fp.mul(6)));
  const dp = wp.mul(vec2(0.55, 1.5));
  const fine = vec2(gnoise(dp.add(t.mul(0.25))), gnoise(dp.yx.mul(1.1).sub(t.mul(0.2))))
    .sub(0.5)
    .mul(vec2(0.06, 0.14))
    .mul(near.mul(u.detail).mul(float(1).sub(u.calm.mul(0.5))));
  return { height: h.toVar(), slope: grad.add(fine).toVar(), crest: crest.toVar() };
}

/** The owner on the water: rings from the resting pointer, and the splash rings their activity raises. */
function stirred(u: ToonSeaUniforms, wp: V2, height: F, slope: V2) {
  const t = u.time;
  const pw = toWorld(u, vec2(u.pointer.x, min(u.pointer.y, u.horizon.sub(0.02)))).add(
    vec2(0, t.mul(DRIFT)),
  );
  const pr = wp.sub(pw);
  const pl = length(pr).add(1e-4);
  const phase = pl.mul(9).sub(t.mul(3.2)).toVar();
  const envelope = u.pointer.z
    .mul(exp(pl.mul(-1.3)))
    .mul(smoothstep(0, 0.25, pl))
    .toVar();
  slope.addAssign(pr.div(pl).mul(cos(phase).mul(9).mul(envelope).mul(0.035)));
  height.addAssign(sin(phase).mul(envelope).mul(0.03));
  let splash: F = float(0);
  for (const s of u.splashes) {
    const age = s.z;
    const e = s.w.mul(step(age, 6)).mul(step(0.01, s.w));
    const ring = ripple(
      wp,
      toWorld(u, s.xy).add(vec2(0, t.sub(age).mul(DRIFT))),
      age.mul(1.6),
      age,
    );
    const rh = ring.height.mul(e);
    slope.addAssign(ring.slope.mul(e.mul(0.12)));
    height.addAssign(rh.mul(0.12));
    splash = max(
      splash,
      aastep(0.6, rh)
        .mul(min(e, 1))
        .mul(exp(age.mul(-0.35))),
    );
  }
  return { phase, envelope, splash: splash.toVar() };
}

/** What the sea's surface looks at: its normal, the view, the light, depth below the horizon, height. */
interface Surface {
  readonly n: V3;
  readonly V: V3;
  readonly Ls: V3;
  readonly R: V3;
  readonly d: F;
  readonly hn: F;
  readonly wp: V2;
  readonly fp: F;
}

/** The water: body stepped by distance, lit through a soft toon ramp, subsurface crests, the mirrored sky. */
function waterBody(u: ToonSeaUniforms, pal: Palette, sky: PictureSampler, s: Surface): V3 {
  const { n, V, Ls, R, d, hn, wp } = s;
  const band = d.add(hn.mul(0.012)).add(fbm4(wp.mul(0.08).add(3)).sub(0.5).mul(0.03));
  const body = mix(
    pal.pick([0.02, 0.16, 0.45], [0.006, 0.012, 0.04]),
    pal.pick([0, 0.13, 0.42], [0.003, 0.016, 0.05]),
    smoothstep(0.05, 0.075, band),
  ).toVar();
  body.assign(
    mix(body, pal.pick([0, 0.2, 0.46], [0.004, 0.03, 0.07]), smoothstep(0.2, 0.26, band)),
  );
  const lam = dot(n, normalize(vec3(Ls.x, 0.8, -0.3)));
  body.mulAssign(mix(0.62, 1.08, smoothstep(0.62, 0.68, lam)));
  const sss = smoothstep(0.15, 0.55, hn)
    .mul(smoothstep(0, 0.25, d))
    .mul(max(dot(V, Ls).mul(0.5).add(0.5), 0));
  body.addAssign(pal.pick([0, 0.38, 0.4], [0, 0.05, 0.07]).mul(sss.mul(0.5)));
  // Toon Fresnel: the mirrored sky (clouds and all), stepped into two values.
  const ruv = vec2(
    R.x.div(R.z).mul(FOCAL).div(u.aspect).add(0.5),
    R.y.div(R.z).mul(FOCAL).add(u.horizon),
  );
  const mirrored = sky(clamp(ruv, vec2(0, u.horizon.add(0.002)), vec2(1, 0.998))).rgb;
  const fr = pow(float(1).sub(max(dot(n, V), 0)), 5);
  const frT = mix(float(0.06), pal.byMood(0.3, 0.26), smoothstep(0.12, 0.3, fr));
  return mix(
    body,
    min(mirrored, vec3(1.1, 1.1, 1.1)).mul(pal.pick([0.62, 0.76, 0.95], [0.3, 0.34, 0.45])),
    frT,
  );
}

/** Foam caps (white, a cool shade on their far side), a fading trail, and thin anime wave lines. */
function foamOn(
  u: ToonSeaUniforms,
  pal: Palette,
  water: V3,
  s: Surface,
  { height, crest }: { readonly height: F; readonly crest: F },
): V3 {
  const { n, Ls, d, wp, fp } = s;
  const breakup = fbm4(wp.mul(vec2(0.9, 0.55)).add(vec2(u.time.mul(0.03), 0)));
  const cap = crest.add(breakup.sub(0.5).mul(0.35)).add(
    gnoise(wp.mul(vec2(1.6, 4)))
      .sub(0.5)
      .mul(0.3),
  );
  const farFade = float(1).sub(smoothstep(0.02, 0.09, fp));
  const foam = aastep(u.calm.mul(0.1).add(0.42), cap).mul(farFade);
  const trail = aastep(0.33, cap)
    .mul(float(1).sub(foam))
    .mul(farFade)
    .mul(smoothstep(0.45, 0.7, gnoise(wp.mul(vec2(1.3, 3)).add(5))));
  const foamC = pal.foam;
  const foamS = pal.pick([0.62, 0.82, 0.92], [0.12, 0.18, 0.32]);
  const col = mix(water, mix(foamS, foamC, smoothstep(-0.1, 0.2, dot(n, Ls))), foam).toVar();
  col.assign(mix(col, foamS.mul(1.05), trail.mul(0.22)));
  const wl = height.mul(9).add(fbm4(wp.mul(0.25)).mul(1.4));
  const line = float(1)
    .sub(smoothstep(0, fwidth(wl).mul(1.3), abs(fract(wl).sub(0.5)).sub(0.47)))
    .mul(smoothstep(0.5, 0.75, gnoise(wp.mul(vec2(0.7, 1.6)).add(11))))
    .mul(float(1).sub(smoothstep(0.01, 0.05, fp)))
    .mul(smoothstep(0.04, 0.12, d));
  return mix(col, foamC.mul(0.95), line.mul(0.55));
}

/** The light's path: a broad stepped sheen, star glints near the horizon, and the splashes' bursts. */
function lightPath(u: ToonSeaUniforms, pal: Palette, s: Surface, splash: F, quiet: F): V3 {
  const t = u.time;
  const spec = max(dot(s.R, s.Ls), 0).toVar();
  const sheen = smoothstep(0.985, 0.99, spec)
    .mul(0.5)
    .add(smoothstep(0.996, 0.998, spec).mul(0.5));
  // Glint cells in CSS pixels, finer toward the horizon.
  const g = screenUV.mul(u.size).div(smoothstep(0, 0.4, s.d).mul(3).add(4.5));
  const id = g.floor();
  const f = g.fract().sub(0.5);
  const hh = hash(id.add(t.mul(2.5).add(hash(id).mul(3)).floor()));
  const twinkle = sin(t.mul(7).add(hh.mul(40)))
    .mul(0.5)
    .add(0.5);
  const glint = step(0.82, hh)
    .mul(smoothstep(0.97, 0.995, spec))
    .mul(star(f.sub(hash2(id).sub(0.5).mul(0.5)), 9))
    .mul(twinkle)
    .mul(u.detail.mul(0.6).add(0.4))
    .mul(float(1).sub(smoothstep(0.1, 0.22, s.d)));
  const burst = splash.mul(hash(id.add(4))).mul(step(0.7, hash(id.add(9))));
  return pal.sun.mul(
    sheen
      .mul(pal.byMood(0.35, 0.25))
      .add(glint.mul(pal.byMood(7, 4)).add(burst.mul(3)).mul(float(1).sub(quiet))),
  );
}

/** The sea at frame uv `at`, `d` below the horizon, its footprint `fp`: everything below the horizon. */
function seaAt(u: ToonSeaUniforms, pal: Palette, sky: PictureSampler, at: V2, fp: F): V3 {
  const t = u.time;
  const d = u.horizon.sub(at.y);
  const wp = toWorld(u, at)
    .add(vec2(0, t.mul(DRIFT)))
    .toVar();
  const { height, slope, crest } = swell(u, wp, fp);
  const owner = stirred(u, wp, height, slope);
  const n = normalize(vec3(slope.x.negate(), 1, slope.y.negate())).toVar();
  const V = normalize(vec3(0, 1, 0).sub(vec3(wp.x, 0, wp.y.sub(t.mul(DRIFT))))).toVar();
  const R0 = reflect(V.negate(), n);
  const surface: Surface = {
    n,
    V,
    Ls: normalize(vec3(u.sun.x.sub(0.5).mul(u.aspect), u.sun.y.sub(u.horizon), FOCAL)).toVar(),
    R: vec3(R0.x, abs(R0.y).add(0.01), R0.z).toVar(),
    d,
    hn: height.div(0.2),
    wp,
    fp,
  };
  const col = foamOn(u, pal, waterBody(u, pal, sky, surface), surface, { height, crest }).toVar();
  // The pointer's wake and the splash rings (bioluminescent at night).
  const wake = aastep(0.82, sin(owner.phase))
    .mul(owner.envelope)
    .mul(1.4)
    .mul(float(1).sub(smoothstep(0.02, 0.06, fp)));
  col.assign(
    mix(
      col,
      mix(pal.foam, vec3(0.14, 1.26, 1.19), u.dark),
      max(wake.mul(0.85), owner.splash.mul(0.9)),
    ),
  );
  col.addAssign(lightPath(u, pal, surface, owner.splash, u.scrim.under(at)));
  // Horizon haze: the last strip of sea dissolves into the horizon's colour; a thin bright seam.
  col.assign(mix(col, pal.horizon.mul(1.02), exp(d.mul(-55)).mul(0.75)));
  col.addAssign(pal.sun.mul(exp(d.mul(-900)).mul(pal.byMood(0.25, 0.125))));
  return col;
}

/**
 * The frame, for `scene.backgroundNode`: the sky's picture above the
 * horizon, the sea below it mirroring that picture, quieter under the
 * head's text, in the page's terms (`Grounds`).
 */
export function seaFrame(u: ToonSeaUniforms, sky: PictureSampler, { ground, paint }: Grounds): V3 {
  return Fn(() => {
    const pal = palette(u);
    const at = vec2(screenUV.x, float(1).sub(screenUV.y)).toVar();
    // The sea's footprint first, where every pixel of a quad takes the same path.
    const fp = length(fwidth(toWorld(u, at))).toVar();
    // The sky's pixels never pay for the sea.
    const shown = vec3(0, 0, 0).toVar();
    If(at.y.lessThan(u.horizon), () => {
      shown.assign(seaAt(u, pal, sky, at, fp));
    }).Else(() => {
      shown.assign(sky(at).rgb);
    });
    // Under the text: darker under light text, paler under dark text, soft at its edges.
    const scrim = u.scrim.under(at).mul(pal.byMood(0.3, 0.26));
    shown.assign(
      mix(
        mix(shown, mix(pal.horizon, vec3(1, 1, 1), 0.6), scrim),
        shown.mul(float(1).sub(scrim)),
        u.dark,
      ),
    );
    // Dark: light graded as the look was drawn (`darkGrade`), its highlights rolled off by the shoulder. Light: the day in the page's
    // own terms, its glints kept above white for the bloom.
    const day = paint(min(shown, vec3(1, 1, 1))).add(max(shown.sub(1), vec3(0, 0, 0)));
    return mix(day, darkGrade(shown, ground), u.dark);
  })();
}
