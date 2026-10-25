/**
 * The Silk backdrop's stage and air (T1), as `silk-shader.ts` lays its
 * ribbons over them: the velvet curtain or the paper, the cosmos it thins
 * into (gas, a galactic band, sparse stars), the key's pool and beam, and
 * the dust in three depths. Kept apart from the ribbons so each file is one
 * concern; the uniforms are the scene's one set (`silkUniforms`).
 */
import {
  abs,
  cos,
  dot,
  exp,
  float,
  floor,
  fract,
  If,
  length,
  mix,
  normalize,
  pow,
  select,
  sin,
  smoothstep,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { PictureSampler, TslNode } from "@kb/scene-gpu";
import { fbm4, hash, hash2 } from "../gpu/noise";
import type { SilkUniforms } from "./silk-shader";

export type F = TslNode<"float">;
export type B = TslNode<"bool">;
export type V2 = TslNode<"vec2">;
export type V3 = TslNode<"vec3">;

/** Depth of field and the stars are art-directed in pixels of a frame this tall. */
export const REFERENCE_HEIGHT = 720;

export const asFloat = (v: F | number): F => (typeof v === "number" ? float(v) : v);
/** A light page's value and a dark page's, by `dark` (0 or 1). */
export const byPage = (light: number, darkValue: number, dark: F): F =>
  mix(float(light), float(darkValue), dark);
export const byPage3 = (light: V3, darkValue: V3, dark: F): V3 => mix(light, darkValue, dark);
export const one = (cond: B): F => select(cond, float(1), float(0));

/** The strip light's band at `q` for a layer at `depth`. */
export type SweepBand = (q: V2, depth: F | number) => F;

/** The key spot's pool of light on the backdrop. */
export function spotPool(q: V2): F {
  const d = q.sub(vec2(0.55, 0.62)).div(vec2(0.9, 0.5));
  return exp(dot(d, d).mul(-1.8));
}

/** The spot's cone through the haze. */
function beam(q: V2): F {
  const dir = normalize(vec2(-0.62, -0.78));
  const r = q.sub(vec2(1.1, 0.9));
  const along = dot(r, dir);
  const across = abs(r.x.mul(dir.y).sub(r.y.mul(dir.x)));
  const width = along.mul(0.26).add(0.07);
  return exp(across.div(width).pow(2).negate()).mul(smoothstep(0, 0.5, along));
}

/** How far past the frame the cosmos pass reaches, so the layers' parallax never runs off it. */
export const COSMOS_MARGIN = 0.06;
/** How far the cosmos drifts with the pointer: it is the farthest layer. */
const COSMOS_PARALLAX = 0.035;

/**
 * The cosmos's slow fields at frame point `q`, for its offscreen pass: the
 * gas's density and hue mix, the galactic band, and its dust lane. They
 * change over minutes, so they are drawn a few times a second at a fraction
 * of the frame's pixels.
 */
export function cosmosFields(u: SilkUniforms, q: V2): TslNode<"vec4"> {
  const wq = fbm4(q.mul(1.2).add(vec2(u.time.mul(0.004), u.time.mul(-0.003)))).toVar();
  const gas = smoothstep(0.42, 0.86, fbm4(q.mul(1.6).add(vec2(wq, wq.negate()).mul(1.9)).add(2)));
  const hueMix = smoothstep(0.35, 0.65, fract(wq.mul(7.31).add(0.37)).mul(0.4).add(0.3));
  const bd = dot(q, normalize(vec2(-0.42, 1)))
    .sub(0.02)
    .sub(sin(q.x.mul(1.4).add(0.6)).mul(0.07));
  const tex = fbm4(q.mul(vec2(4, 7)).add(3));
  const band = exp(bd.mul(bd).div(-0.025)).mul(tex.mul(0.45).add(0.55));
  // Its dust lane.
  const lane = float(1).sub(
    exp(bd.sub(0.01).add(tex.sub(0.5).mul(0.03)).pow(2).div(-0.0009))
      .mul(smoothstep(0.4, 0.65, tex))
      .mul(0.65),
  );
  return vec4(gas.mul(gas), hueMix, band, lane);
}

/** The cosmos at `q`, read from its pass (`fields`), drifted by the parallax and kept off the text. */
export function cosmosAt(u: SilkUniforms, q: V2, away: F, fields: PictureSampler) {
  const w = u.cosmosWindow;
  const at = q.sub(u.parallax.mul(COSMOS_PARALLAX)).sub(w.xy).div(w.zw.sub(w.xy));
  const f = fields(at).toVar();
  const hue = byPage3(
    mix(vec3(0.82, 0.7, 0.95), vec3(0.66, 0.84, 0.95), f.y),
    mix(vec3(0.3, 0.06, 0.34), vec3(0.04, 0.17, 0.34), f.y),
    u.dark,
  ).toVar();
  return { hue, density: f.x.mul(away).toVar(), band: f.z.mul(away).toVar(), lane: f.w };
}

export type Cosmos = ReturnType<typeof cosmosAt>;

/** Sparse stars in two layers with parallax; a few twinkle; more of them in the band. */
function starsAt(u: SilkUniforms, q: V2, band: F): V3 {
  let light: V3 = vec3(0, 0, 0);
  for (let l = 0; l < 2; l++) {
    const cell = 10 + l * 7; // in pixels of the reference frame: the far layer is finer
    const sp = q.sub(u.parallax.mul(0.012 + l * 0.02)).mul(REFERENCE_HEIGHT / cell);
    const id = floor(sp);
    const r = fract(sp)
      .sub(0.5)
      .sub(
        hash2(id.add(3.1 + l))
          .sub(0.5)
          .mul(0.6),
      );
    const h = hash(id.add(l * 17.3));
    const h2 = hash(id.add(9.7));
    const spot = exp(dot(r, r).mul(-(cell * cell) / (0.55 + l * 0.4)));
    const twinkle = select(
      h2.greaterThan(0.82),
      pow(
        sin(u.time.mul(h2.mul(2.5).add(1.6)).add(h.mul(60)))
          .mul(0.5)
          .add(0.5),
        3,
      )
        .mul(0.65)
        .add(0.35),
      float(1),
    );
    const tint = mix(vec3(1, 0.82, 0.64), vec3(0.72, 0.82, 1), hash(id.add(5)));
    const shown = one(h.greaterThan(float(l === 0 ? 0.992 : 0.988).sub(band.mul(0.03))));
    light = light.add(
      tint.mul(
        spot
          .mul(twinkle)
          .mul(h2.mul(0.75).add(0.25))
          .mul(shown)
          .mul(l === 0 ? 0.5 : 0.8),
      ),
    );
  }
  return light;
}

/** A dark page's stage: a velvet curtain in the spot, thinning into space, and haze in the beam. */
export function velvetAt(u: SilkUniforms, q: V2, ground: V3, cosmos: Cosmos, away: F): V3 {
  const t = u.time;
  const fx = q.x
    .mul(19)
    .add(sin(q.y.mul(1.4).add(q.x.mul(2.1)).add(t.mul(0.07))).mul(1.6))
    .add(sin(q.x.mul(5.3).sub(t.mul(0.05))).mul(0.8));
  const nx = sin(fx)
    .mul(0.8)
    .add(sin(fx.mul(2.3).add(1)).mul(0.18));
  // Velvet is dark face-on and bright at grazing.
  const graze = pow(float(1).sub(normalize(vec3(nx, 0.1, 1)).z), 1.6);
  const pool = spotPool(q)
    .mul(smoothstep(0.05, 0.42, q.y))
    .toVar();
  const sheer = float(1).sub(pool).mul(0.45).add(0.55);
  const hz = beam(q)
    .mul(smoothstep(-0.1, 0.3, q.y))
    .mul(
      fbm4(q.mul(vec2(2.2, 3)).add(vec2(t.mul(0.03), t.mul(-0.02))))
        .mul(0.55)
        .add(0.45),
    );
  return ground
    .mul(float(1).sub(graze).mul(0.3).add(0.7))
    .add(vec3(0.03, 0.003, 0.01).mul(pool.mul(1.2).add(0.2)).mul(float(1).sub(graze)))
    .add(vec3(0.42, 0.05, 0.1).mul(graze.mul(pool.mul(0.55).add(0.02))))
    .add(vec3(0.06, 0.09, 0.2).mul(graze.mul(0.25).mul(smoothstep(0.2, -0.6, q.x))))
    .add(cosmos.hue.mul(cosmos.density.mul(0.13).mul(sheer)))
    .add(vec3(0.42, 0.36, 0.5).mul(cosmos.band.mul(cosmos.lane).mul(0.045).mul(sheer)))
    .add(
      starsAt(u, q, cosmos.band)
        .mul(away.mul(0.75).add(0.25).mul(0.22).mul(sheer))
        .mul(float(1).sub(smoothstep(0.3, 0.9, pool))),
    )
    .add(vec3(1, 0.82, 0.66).mul(hz.mul(0.2).mul(float(1).sub(u.calm.mul(0.3)))));
}

/** A light page's stage: the paper, brighter where the softbox lands, a pastel breath of gas. */
export function paperAt(q: V2, page: V3, cosmos: Cosmos): V3 {
  const d = q.sub(vec2(-0.5, 0.5)).div(vec2(1.4, 0.8));
  const paper = page.mul(exp(dot(d, d).negate()).mul(0.05).add(1));
  return mix(paper, paper.mul(cosmos.hue).mul(1.08), cosmos.density.mul(0.16)).mul(
    vec3(1, 1, 1).sub(vec3(0.6, 0.5, 0.2).mul(cosmos.band.mul(cosmos.lane).mul(0.025))),
  );
}

/** The pointer's wind at `p`: a few puffs, each a spreading, fading Gaussian push. */
function windAt(u: SilkUniforms, p: V2): V2 {
  let d: V2 = vec2(0, 0);
  u.puffs.forEach((puff, k) => {
    const a = u.puffAges[k] ?? float(99);
    const c = puff.xy.add(
      puff.zw.mul(
        float(1)
          .sub(exp(a.mul(-1.5)))
          .mul(0.35),
      ),
    );
    const sg = a.mul(0.07).add(0.07);
    const r = p.sub(c);
    d = d.add(
      puff.zw
        .mul(exp(dot(r, r).div(sg.mul(sg)).negate()))
        .mul(exp(a.mul(-1.1)))
        .mul(float(1).sub(exp(a.mul(-8)))),
    );
  });
  return d;
}

/**
 * Dust in three depths (FG bokeh, MG motes, BG specks), each at its layer's
 * rate, lit by the beam and the sweep and coloured by the light that reaches
 * it: warm on the spot side, the cool gel on the left, the gas's hue.
 */
/** What the air between the layers holds at a pixel: the haze's colour, the gas's density, the text's keep-clear. */
export interface Air {
  readonly haze: V3;
  readonly density: F;
  readonly away: F;
}

export function dustAt(
  u: SilkUniforms,
  sweepBand: SweepBand,
  q: V2,
  { haze, density, away }: Air,
): V3 {
  const dark = u.dark;
  const t = u.time;
  const lit0 = byPage(0.3, 0, dark)
    .add(beam(q).mul(1.1).add(spotPool(q).mul(0.15)).add(0.05).mul(dark))
    .mul(smoothstep(-0.1, 0.3, q.y))
    .toVar();
  const warm = byPage3(vec3(1, 0.97, 0.9), vec3(1, 0.8, 0.58), dark);
  const cool = byPage3(vec3(0.86, 0.92, 1), vec3(0.55, 0.7, 1), dark);
  const tint = mix(
    mix(warm, cool, smoothstep(0.1, -0.7, q.x)),
    normalize(haze.add(0.02)).mul(1.4),
    density.mul(byPage(0.3, 0.7, dark)),
  ).toVar();
  const wind = vec2(0, 0).toVar();
  If(u.puffCount.greaterThan(0), () => {
    wind.assign(windAt(u, q));
  });
  let light: V3 = vec3(0, 0, 0);
  for (let l = 0; l < 3; l++) {
    const dl = [-1, 0.1, 0.9][l] ?? 0; // FG, MG, BG
    const lit = lit0.add(
      sweepBand(q, dl)
        .mul(float(1).sub(u.calm))
        .mul(byPage(0.4, 0.7, dark)),
    );
    const p0 = q
      .mul(1 + dl * 0.12)
      .add(u.parallax.mul((0.035 - dl * 0.075) * (l === 0 ? 1.6 : 1)))
      .add(wind.mul(0.6 + l * 0.3))
      .add(vec2(t.mul(0.006 * (1 + l)), t.mul(0.012 + l * 0.006)));
    const p = p0
      .add(
        vec2(sin(p0.y.mul(3).add(t.mul(0.2)).add(l)), cos(p0.x.mul(2).add(t.mul(0.15)))).mul(0.01),
      )
      .mul(7 + l * 10);
    const id = floor(p);
    const h = hash(id.add(l * 31.7));
    const radius = [0.2, 0.1, 0.06][l] ?? 0.1;
    const d = length(
      fract(p)
        .sub(0.5)
        .sub(
          hash2(id.add(7.1 * l))
            .sub(0.5)
            .mul(0.6),
        ),
    );
    const disc0 = float(1).sub(smoothstep(radius * (l === 0 ? 0.5 : 0.3), radius, d));
    // A bokeh disc rims brighter.
    const disc =
      l === 0
        ? disc0.mul(
            smoothstep(radius * 0.5, radius, d)
              .mul(0.45)
              .add(0.55),
          )
        : disc0;
    const twinkle = sin(t.mul(h.mul(2).add(1.3)).add(h.mul(40)))
      .mul(0.45)
      .add(0.55);
    const gain = l === 0 ? away.mul(0.3) : float(l === 1 ? 0.8 : 1.4);
    light = light.add(
      mix(tint, vec3(1, 1, 1), hash(id.add(2)).mul(0.25))
        .mul(
          disc
            .mul(twinkle)
            .mul(lit)
            .mul(gain)
            .mul(byPage(0.5, 1, dark)),
        )
        .mul(one(h.greaterThan(l === 0 ? 0.95 : 0.86))),
    );
  }
  return light;
}
