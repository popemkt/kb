/**
 * The GPU backdrops' noise and light, as TSL functions (Lab principle T1):
 * one WGSL/GLSL function each (`setLayout`), so a field that calls them in a
 * loop compiles once, not inlined at every call.
 *
 * - `hash`, `hash2`: Dave Hoskins' hash without sine, stable across GPUs.
 * - `gnoise`: gradient noise with a quintic fade, in 0..1 (centred on 0.5).
 * - `pnoise`: the same, periodic in x with a period of `per` cells, so a
 *   disk's angle wraps without a seam.
 * - `fbm`, `fbm4`, `ridged`: fractal sums of it (6, 4 and 5 octaves), each
 *   octave turned and scaled so no grid shows.
 * - `blackbody`: a smooth fit of Planck's locus, temperature in kK.
 */
import {
  Fn,
  clamp,
  dot,
  float,
  floor,
  fract,
  log,
  max,
  mix,
  pow,
  select,
  vec2,
  vec3,
} from "three/tsl";
import type { TslNode } from "@kb/scene-gpu";

type F = TslNode<"float">;
type V2 = TslNode<"vec2">;

const hashFn = Fn(([p]: readonly [V2]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, vec3(p3.y, p3.z, p3.x).add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: "kbHash", type: "float", inputs: [{ name: "p", type: "vec2" }] });

const hash2Fn = Fn(([p]: readonly [V2]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(vec3(0.1031, 0.103, 0.0973))).toVar();
  p3.addAssign(dot(p3, vec3(p3.y, p3.z, p3.x).add(33.33)));
  return fract(vec2(p3.x, p3.x).add(vec2(p3.y, p3.z)).mul(vec2(p3.z, p3.y)));
}).setLayout({ name: "kbHash2", type: "vec2", inputs: [{ name: "p", type: "vec2" }] });

export const hash = (p: V2): F => hashFn(p);
export const hash2 = (p: V2): V2 => hash2Fn(p);

/** The gradient sum shared by `gnoise` and `pnoise`: corners `i00`…`i11`, position `f` in the cell. */
function gradient(i00: V2, i10: V2, i01: V2, i11: V2, f: V2): F {
  const u = f
    .mul(f)
    .mul(f)
    .mul(f.mul(f.mul(6).sub(15)).add(10));
  const g = (cell: V2, corner: V2) => dot(hash2(cell).mul(2).sub(1), f.sub(corner));
  const bottom = mix(g(i00, vec2(0, 0)), g(i10, vec2(1, 0)), u.x);
  const top = mix(g(i01, vec2(0, 1)), g(i11, vec2(1, 1)), u.x);
  return float(0.5).add(mix(bottom, top, u.y).mul(0.7));
}

const gnoiseFn = Fn(([p]: readonly [V2]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  return gradient(i, i.add(vec2(1, 0)), i.add(vec2(0, 1)), i.add(vec2(1, 1)), f);
}).setLayout({ name: "kbGnoise", type: "float", inputs: [{ name: "p", type: "vec2" }] });

const pnoiseFn = Fn(([p, per]: readonly [V2, F]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const x0 = i.x.mod(per);
  const x1 = i.x.add(1).mod(per);
  return gradient(vec2(x0, i.y), vec2(x1, i.y), vec2(x0, i.y.add(1)), vec2(x1, i.y.add(1)), f);
}).setLayout({
  name: "kbPnoise",
  type: "float",
  inputs: [
    { name: "p", type: "vec2" },
    { name: "per", type: "float" },
  ],
});

export const gnoise = (p: V2): F => gnoiseFn(p);
export const pnoise = (p: V2, per: number): F => pnoiseFn(p, float(per));

/** Turn and scale for the next octave: no octave lines up with another's grid. */
const turn = (p: V2): V2 => vec2(p.x.mul(1.6).sub(p.y.mul(1.2)), p.x.mul(1.2).add(p.y.mul(1.6)));

function fractal(name: string, octaves: number, octave: (p: V2) => F) {
  const fn = Fn(([start]: readonly [V2]) => {
    let p: V2 = start;
    let sum: F = float(0);
    let amplitude = 0.5;
    for (let i = 0; i < octaves; i++) {
      sum = sum.add(octave(p).mul(amplitude));
      p = turn(p).toVar();
      amplitude *= 0.5;
    }
    return sum;
  }).setLayout({ name, type: "float", inputs: [{ name: "p", type: "vec2" }] });
  return (p: V2): F => fn(p);
}

export const fbm = fractal("kbFbm", 6, gnoise);
export const fbm4 = fractal("kbFbm4", 4, gnoise);
export const ridged = fractal("kbRidged", 5, (p) => float(1).sub(gnoise(p).mul(2).sub(1).abs()));

const blackbodyFn = Fn(([kelvin]: readonly [F]) => {
  const t = clamp(kelvin, 1, 40).toVar();
  const hot = t.greaterThanEqual(6.6);
  const over = max(t.mul(10).sub(60), 0.001);
  const r = select(hot, clamp(pow(over, -0.1332).mul(1.29), 0, 1), float(1));
  const g = select(
    hot,
    pow(over, -0.0755).mul(1.29),
    clamp(log(t.mul(10)).mul(0.39).sub(0.634), 0, 1),
  );
  const b = select(
    t.lessThan(1.9),
    float(0),
    select(
      hot,
      float(1),
      clamp(
        log(max(t.mul(10).sub(10), 0.001))
          .mul(0.543)
          .sub(1.196),
        0,
        1,
      ),
    ),
  );
  const c = vec3(r, g, b);
  return c.mul(c);
}).setLayout({ name: "kbBlackbody", type: "vec3", inputs: [{ name: "t", type: "float" }] });

/** A blackbody's colour at `t` thousand kelvin (1–40), roughly linear light. */
export const blackbody = (t: F): TslNode<"vec3"> => blackbodyFn(t);
