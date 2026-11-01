/**
 * The medallion's metal, lit: one model for every metal surface in the
 * scene, the medallion's steel and its chain alike, so each is the same
 * metal under the same lights and differs only by its surface (its normal,
 * the way it is brushed, its reflectance, its grime and wear).
 *
 * - A metal's reflectance (Schlick Fresnel) over its surroundings
 *   reflected: a dim warm floor the embers light, a cool sky, a soft window
 *   up left (held apart as `windowed`, which a day's exposure holds back).
 * - The key, falling across the scene from its upper left as a gradient,
 *   in a brushed anisotropic lobe (Ward) along the surface's brushing, with
 *   a pin-hot highlight where a face meets it square; the embers' warmth
 *   from below; a low glint circling; a broad sheen sweeping across every
 *   `SWEEP_PERIOD` seconds; and the smoke's hot rim on the faces that turn
 *   to it (`rim`, held apart, as a dark page and a light one spend it
 *   differently).
 * - Every lobe is antialiased by the normal's own variance across the
 *   pixel (geometric specular AA, `SPECULAR_AA`).
 */
import {
  cos,
  cross,
  dFdx,
  dFdy,
  dot,
  exp,
  float,
  fract,
  length,
  max,
  mix,
  normalize,
  pow,
  sin,
  smoothstep,
  sqrt,
  vec2,
  vec3,
} from "three/tsl";
import { Vector3 } from "three/webgpu";
import type { TslNode } from "@kb/scene-gpu";

type F = TslNode<"float">;
type V2 = TslNode<"vec2">;
type V3 = TslNode<"vec3">;

/** The key light and the embers' warmth (linear), and the surroundings: a warm floor and a cool sky. */
export const KEY = vec3(0.72, 0.8, 0.95);
export const WARM = vec3(1.0, 0.42, 0.14);
const SKY = vec3(0.07, 0.08, 0.1);
const FLOOR = vec3(0.05, 0.025, 0.012);
/** The way the hot rim light comes from: below and right, where the smoke and embers are. */
export const RIM_SIDE = vec2(0.35, -0.94);
/** The way the key falls across the scene (upper left to lower right), and the way the sheen sweeps, and how often (s). */
const KEY_ACROSS = vec2(-0.65, 0.76);
const SWEEP_WAY = vec2(0.71, -0.71);
const SWEEP_PERIOD = 9;
/** The key light and the warm light from below, as directions toward them. */
const KEY_DIR = new Vector3(-0.55, 0.65, 0.6).normalize();
const WARM_DIR = new Vector3(0.15, -0.85, 0.5).normalize();

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
 * A metal surface at a point: where it is (medallion units), its normal,
 * the way it is brushed (a direction, roughly in its plane), its
 * reflectance at normal incidence, and its grime and wear.
 */
export interface MetalSurface {
  readonly q: V2;
  readonly normal: V3;
  readonly brushed: V3;
  readonly albedo: V3;
  readonly grime: F;
  readonly worn: F;
}

/**
 * The lights on the surface (`spread`, how far its normal turns across the
 * pixel, a slope's variance, which every lobe widens by).
 */
function metalLights({ q, normal, brushed, grime, worn }: MetalSurface, spread: F, time: F) {
  const view = vec3(0, 0, 1);
  const tangent = normalize(brushed.sub(normal.mul(dot(normal, brushed))));
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
  // A glint circles the bevels slowly: a low light going round.
  const orbit = time.mul(0.42);
  const circling = normalize(vec3(cos(orbit), sin(orbit), float(0.32)));
  const glint = lobe(circling, 0.07, 0.3).mul(worn.mul(0.8).add(0.5)).mul(clean).toVar();
  // A sheen sweeps across, upper left to lower right: a broad light passing over it.
  const along = dot(q, SWEEP_WAY).sub(fract(time.div(SWEEP_PERIOD)).mul(5).sub(2.5));
  const sweep = exp(along.div(0.42).pow(2).negate())
    .mul(lobe(normalize(vec3(SWEEP_WAY.mul(0.6), float(1))), 0.6, 0.6))
    .mul(worn.mul(0.6).add(0.4));
  // The smoke's side lights the faces that turn to it: a hot, narrow rim, only the edge on that side.
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
 * The surface lit: its light (`lit`), the window's share of it
 * (`windowed`), the glint and the smoke's rim, how far its normal turns
 * across the pixel (`spread`), how much its grime occludes (`occluded`) and
 * where the key's gradient falls on it (`across`, 0 to 1).
 */
export function metalLit(surface: MetalSurface, time: F) {
  const { q, normal, albedo, grime } = surface;
  const view = vec3(0, 0, 1);
  // How far the normal turns across the pixel: the lobes widen by it (geometric specular AA).
  const dnx = dFdx(normal);
  const dny = dFdy(normal);
  const spread = dot(dnx, dnx)
    .add(dot(dny, dny))
    .mul(SPECULAR_AA.variance)
    .min(SPECULAR_AA.most)
    .toVar();
  const fresnel = albedo.add(
    vec3(1, 1, 1)
      .sub(albedo)
      .mul(pow(float(1).sub(normal.z), 5)),
  );
  const { highlight, glint, rim } = metalLights(surface, spread, time);
  // Its surroundings, reflected: a dim warm floor lit by the embers, a cool sky, a soft window up left.
  const ray = normal.mul(normal.z.mul(2)).sub(view);
  const sky = mix(FLOOR, SKY, smoothstep(-0.5, 0.7, ray.y));
  const window = exp(
    length(ray.xy.sub(vec2(-0.45, 0.5)))
      .pow(2)
      .mul(-10),
  ).mul(0.9);
  const surroundings = sky.add(KEY.mul(window.mul(0.8)));
  const occluded = float(1).sub(grime.mul(0.94)).toVar();
  // What the window alone puts on it: a day's exposure holds it back, or it is a fog over the steel.
  const windowed = fresnel
    .mul(KEY.mul(window.mul(0.8)))
    .mul(occluded)
    .toVar();
  // The key falls across from its upper left: a gradient, so the relic is lit, not printed.
  const across = smoothstep(-1.1, 1.1, dot(q, KEY_ACROSS)).toVar();
  const lit = fresnel.mul(
    surroundings
      .mul(occluded)
      .mul(mix(0.45, 1.3, across))
      .add(highlight),
  );
  return { lit, windowed, glint, rim, spread, occluded, across };
}
