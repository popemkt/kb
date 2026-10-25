/**
 * The Lens backdrop's shaders (T1): a dark star bending the light of a
 * nebula behind it.
 *
 * - **The nebula** is drawn offscreen in the source plane (`nebulaFragment`),
 *   at a fraction of the frame's pixels and a few times a second: it is soft,
 *   and it turns and evolves over minutes. Emission gas, domain-warped twice;
 *   ridged filaments; dust lanes that absorb (kept in alpha, so the stars
 *   behind them dim too); a region mask, so space has room, with one cloud
 *   always near where the star rests. Hot cores are the gas's only HDR.
 * - **The frame** (`lensFrame`) bends each pixel's ray by a point mass, the
 *   lens equation β = θ − θE² θ / |θ|², and reads the nebula and the stars
 *   where the ray came from: arcs, an Einstein ring, the image doubled
 *   across it. The stars are drawn per pixel, so they stay crisp, brighter
 *   where the lens magnifies them.
 * - **A supernova** in the source plane is lensed analytically: two images
 *   at θ± = β/2 · (1 ± √(1 + 4θE²/β²)), each flaring by its own
 *   magnification, with four-point glints, and an arc while it is aligned.
 * - **Dark** pages show it as light; **light** pages as a plate negative,
 *   the light absorbed out of the page's paper as silver.
 */
import {
  Fn,
  abs,
  dot,
  exp,
  float,
  length,
  max,
  min,
  mix,
  normalize,
  pow,
  screenSize,
  screenUV,
  smoothstep,
  sqrt,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { Color, Vector2, Vector4 } from "three/webgpu";
import type { TslNode } from "@kb/scene-gpu";
import { colorUniform } from "@kb/scene-gpu";
import type { Grounds } from "../gpu/gpu-scene";
import { blackbody, fbm, fbm4, hash, hash2, ridged } from "../gpu/noise";

type F = TslNode<"float">;
type V2 = TslNode<"vec2">;
type V3 = TslNode<"vec3">;

/** Everything the CPU sets: one set of uniforms both shaders read. */
export function lensUniforms() {
  return {
    time: uniform(0),
    dark: uniform(1),
    /** The dark star, in frame units (height 1, origin at the centre, y up). */
    lens: uniform(new Vector2()),
    /** θE: the Einstein radius, frame units. */
    einstein: uniform(0.15),
    mass: uniform(1),
    supernova: uniform(new Vector2()),
    supernovaAge: uniform(99),
    /** The source plane the nebula pass covers: x0, y0, x1, y1. */
    window: uniform(new Vector4(-1, -1, 1, 1)),
    // The seed's choices.
    offset: uniform(new Vector2()),
    spin: uniform(0.0015),
    warp: uniform(3.5),
    density: uniform(1),
    starCut: uniform(0.94),
    cloud: uniform(new Vector2()),
    core: colorUniform(new Color()),
    rim: colorUniform(new Color()),
    filament: colorUniform(new Color()),
  };
}
export type LensUniforms = ReturnType<typeof lensUniforms>;

const rotate = (p: V2, a: F): V2 => {
  const c = a.cos();
  const s = a.sin();
  return vec2(p.x.mul(c).add(p.y.mul(s)), p.y.mul(c).sub(p.x.mul(s)));
};

/** The nebula at source point `sp`: its light, and its dust in alpha. */
function nebulaAt(u: LensUniforms, sp: V2): TslNode<"vec4"> {
  const p = rotate(sp, u.time.mul(u.spin)).mul(1.25).add(u.offset).toVar();
  const e = u.time.mul(0.0025); // the warp itself drifts, noticed over minutes
  const q = vec2(fbm(p.add(vec2(0, e))), fbm(p.add(vec2(5.2, 1.3)).sub(e))).toVar();
  const r = vec2(
    fbm(p.add(q.mul(u.warp)).add(vec2(1.7, 9.2)).add(e.mul(0.7))),
    fbm(p.add(q.mul(u.warp)).add(vec2(8.3, 2.8))),
  ).toVar();
  const f = fbm(p.add(r.mul(u.warp))).toVar();
  const fil = pow(ridged(p.mul(2.3).add(r.mul(1.5))), 3);
  const dust = smoothstep(0.42, 0.75, fbm4(p.mul(2.6).add(q.mul(2)).add(11))).toVar();
  // The nebula has a shape, and space has room; one cloud always rests near the star.
  const toCloud = sp.sub(u.cloud);
  const region = smoothstep(0.4, 0.75, fbm4(p.mul(0.33).add(u.offset.mul(0.1)).add(4)))
    .mul(0.7)
    .add(exp(dot(toCloud, toCloud.mul(vec2(1.2, 4))).mul(-2.2)))
    .clamp(0, 1);
  const gas = pow(smoothstep(0.28, 0.98, f.mul(u.density)), 1.9)
    .mul(region)
    .toVar();
  const light = mix(u.rim.mul(0.6), u.core, smoothstep(0.5, 0.85, f))
    .mul(gas.mul(1.3))
    .add(u.rim.mul(region.mul(f).mul(0.03)))
    .add(u.filament.mul(fil.mul(gas).mul(1.6)))
    // Hot cores: the only HDR in the gas, so the bloom finds them.
    .add(mix(u.core, vec3(1, 1, 1), 0.4).mul(pow(gas, 3).mul(3)));
  return vec4(light.mul(float(1).sub(dust.mul(0.85))), dust);
}

/** The offscreen pass: the nebula over the source plane `window`. */
export function nebulaFragment(u: LensUniforms): TslNode<"vec4"> {
  return Fn(() => {
    const at = uv();
    const sp = vec2(mix(u.window.x, u.window.z, at.x), mix(u.window.y, u.window.w, at.y));
    return nebulaAt(u, sp);
  })();
}

/** Coloured stars at `p`, in three layers; the nearest have the most light. */
function starsAt(u: LensUniforms, p: V2): V3 {
  let light: V3 = vec3(0, 0, 0);
  for (let layer = 0; layer < 3; layer++) {
    const g = p.mul(60 + layer * 70).add(layer * 17);
    const id = g.floor();
    const f = g.fract().sub(0.5);
    const h = hash(id.add(u.offset));
    const shown = smoothstep(u.starCut.add(layer * 0.012), u.starCut.add(layer * 0.012 + 0.002), h);
    const o = hash2(id.add(3.1)).sub(0.5).mul(0.7);
    const d = length(f.sub(o));
    const kelvin = mix(3, 14, hash(id.add(9)));
    const brightness = pow(hash(id.add(1.9)), 3).mul(layer === 0 ? 6 : 2);
    const spot = exp(d.mul(d).mul(layer === 0 ? -900 : -1600));
    light = light.add(blackbody(kelvin).mul(brightness.mul(spot).mul(shown)));
  }
  return light;
}

/** A four-point glint at offset `d`, of size `s`: a core, two spikes, a halo. */
function glint(d: V2, s: number): V3 {
  const a = abs(d);
  const core = exp(dot(a, a).div(-(s * s * 0.00012)));
  const spikes = exp(a.x.div(-(s * 0.006)))
    .mul(exp(a.y.div(-(s * 0.16))))
    .add(exp(a.y.div(-(s * 0.006))).mul(exp(a.x.div(-(s * 0.16)))));
  const halo = exp(length(a).div(-(s * 0.03)));
  return vec3(1, 0.93, 0.85)
    .mul(core.mul(6))
    .add(vec3(0.9, 0.85, 1).mul(spikes.mul(0.9)))
    .add(vec3(1, 0.8, 0.6).mul(halo.mul(0.6)));
}

/**
 * The frame, for `scene.backgroundNode`: the lensed nebula (`nebula`, the
 * offscreen picture), the stars, the supernova, the shadow and the ring,
 * over the page's ground: lit on a dark page, a plate negative composed in
 * the page's own terms on a light one (`Grounds`).
 */
export function lensFrame(
  u: LensUniforms,
  nebula: (uv: V2) => TslNode<"vec4">,
  { ground, page, paint }: Grounds,
): V3 {
  return Fn(() => {
    const aspect = screenSize.x.div(screenSize.y);
    const q = vec2(screenUV.x.sub(0.5).mul(aspect), float(0.5).sub(screenUV.y));
    const d = q.sub(u.lens).toVar();
    const r = length(d).toVar();
    const tE = u.einstein.mul(u.mass).toVar();
    const beta = q.sub(d.mul(tE.mul(tE)).div(r.mul(r).add(1e-6))).toVar();
    const magnified = min(float(1).div(abs(float(1).sub(pow(tE.div(max(r, 1e-3)), 4)))), 5);
    const span = vec2(u.window.z.sub(u.window.x), u.window.w.sub(u.window.y));
    const gas = nebula(beta.sub(vec2(u.window.x, u.window.y)).div(span)).toVar();
    const light = gas.rgb
      .add(
        starsAt(u, beta)
          .mul(magnified)
          .mul(float(1).sub(gas.a.mul(0.8))),
      )
      .toVar();
    // The supernova's two images, each as bright as it is magnified.
    const b = u.supernova.sub(u.lens);
    const bl = max(length(b), 1e-4);
    const bu = b.div(bl);
    const root = sqrt(float(1).add(tE.mul(tE).mul(4).div(bl.mul(bl))));
    const plus = u.lens.add(bu.mul(bl.mul(0.5).mul(float(1).add(root))));
    const minus = u.lens.add(bu.mul(bl.mul(0.5).mul(float(1).sub(root))));
    const k = bl.div(max(tE, 1e-4));
    const base = k
      .mul(k)
      .add(2)
      .div(k.mul(2).mul(sqrt(k.mul(k).add(4))));
    const life = smoothstep(0, 0.06, u.supernovaAge).mul(exp(u.supernovaAge.mul(-1.1)));
    const toArc = beta.sub(u.supernova);
    light.addAssign(
      glint(q.sub(plus), 0.9)
        .mul(min(base.add(0.5), 6))
        .add(glint(q.sub(minus), 0.9).mul(min(abs(base.sub(0.5)), 6)))
        .add(vec3(1, 0.8, 0.6).mul(exp(dot(toArc, toArc).mul(-1800)).mul(3)))
        .mul(life),
    );
    const umbra = smoothstep(tE.mul(0.47), tE.mul(0.42), r);
    const ring = exp(r.sub(tE.mul(0.5)).div(tE.mul(0.016).add(0.001)).pow(2).negate());
    const halo = exp(
      max(r.sub(tE.mul(0.5)), 0)
        .div(tE.mul(0.35).add(0.01))
        .negate(),
    );
    // Dark: light over the ground, the star's shadow, its photon ring burning.
    const lit = ground
      .add(light)
      .mul(float(1).sub(umbra))
      .add(vec3(1, 0.85, 0.7).mul(2.2).add(u.core.mul(0.4)).mul(ring.mul(u.mass)))
      .add(u.core.mul(halo.mul(float(1).sub(umbra)).mul(0.05).mul(u.mass)));
    // Light: a plate negative, the light absorbed out of the paper as silver.
    const luma = dot(light, vec3(0.3, 0.55, 0.15));
    const ink = mix(vec3(0.1, 0.1, 0.15), u.rim.mul(0.25), 0.3);
    const tint = mix(vec3(1, 1, 1), normalize(light.add(1e-3)).mul(1.7), 0.25);
    const absorbed = vec3(1, 1, 1).sub(ink).mul(tint);
    const plate = page
      .mul(
        exp(
          absorbed.mul(
            float(1)
              .sub(exp(luma.mul(-3.2)))
              .mul(-1.9),
          ),
        ),
      )
      .mul(float(1).sub(ring.mul(0.75).mul(u.mass)));
    const negative = paint(mix(plate, page.mul(1.04), umbra));
    return mix(negative, lit, u.dark);
  })();
}
