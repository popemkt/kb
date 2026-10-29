/**
 * Gradient orbs' shader (T1): soft glowing spheres on a deep field. One
 * pass per pixel and no offscreen picture: four circles' distance fields,
 * each shaded as a sphere and laid over the ones behind it, so it is among
 * the lightest of the GPU backdrops.
 *
 * - **An orb** is its circle's signed distance. Inside it, the offset from
 *   the centre against the radius is a sphere's profile, which gives a
 *   normal; a lamp in front of the frame lights it from where its centre
 *   sees the lamp, dimmer the farther it is. Its light runs a ramp from the
 *   shadow's deep blue through violet and rose to a peach highlight, and
 *   the limb facing the lamp is lit as a rim.
 * - **Smooth blending.** An orb's edge is soft, crisp where the lamp catches
 *   it and melting into the field on its shadow side; its glow spills past
 *   the lit limb and adds over whatever lies behind. Orbs are laid back to
 *   front (`orbs[0]`, the great orb, in front), so where two drift across
 *   each other the nearer one's soft edge blends into the farther.
 * - **Dark** pages paint the reference's palette over a deep blue field
 *   that lifts toward the lamp. **Light** pages paint its pair: pastel
 *   peach and lilac on a periwinkle wash of the page's own paper (`Grounds`).
 */
import {
  Fn,
  dot,
  exp,
  float,
  length,
  max,
  mix,
  normalize,
  pow,
  screenSize,
  screenUV,
  smoothstep,
  sqrt,
  uniform,
  uniformArray,
  vec2,
  vec3,
} from "three/tsl";
import { Vector3, Vector4 } from "three/webgpu";
import type { TslNode } from "@kb/scene-gpu";
import type { Grounds } from "../gpu/gpu-scene";
import type { textScrim } from "../gpu/text-scrim";
import { ORBS } from "./orbs";

type F = TslNode<"float">;
type V3 = TslNode<"vec3">;

/** The dark ramp (linear), shadow to highlight: the reference's blue, violet, rose and peach. */
const DEEP = vec3(0.05, 0.08, 0.56);
const VIOLET = vec3(0.2, 0.1, 0.72);
const ROSE = vec3(0.74, 0.21, 0.42);
const PEACH = vec3(1.0, 0.64, 0.44);
/** The cool rim round an orb's far limb. */
const LILAC_RIM = vec3(0.42, 0.3, 1.0);
/** The dark field: a deep blue, lifting toward the lamp. */
const FIELD = vec3(0.008, 0.018, 0.13);
const FIELD_LIT = vec3(0.02, 0.045, 0.3);
/** The light pair (shares of the paper): lilac shadow, periwinkle, rose and a cream highlight. */
const LILAC = vec3(0.52, 0.52, 0.92);
const PERIWINKLE = vec3(0.66, 0.6, 0.97);
const BLUSH = vec3(0.98, 0.68, 0.8);
const CREAM = vec3(1.0, 0.88, 0.78);
const WASH = vec3(0.9, 0.91, 1.0);
/** Where the ramps' stops start, over an orb's light (-1 to 1). */
const STOPS = [-0.1, 0.3, 0.62, 0.92] as const;

/** Everything the CPU sets. Per orb: `orbs[i]` x y r light (frame units). */
export function orbUniforms() {
  const placed = Array.from({ length: ORBS }, () => new Vector4());
  return {
    placed,
    orbs: uniformArray<"vec4">(placed, "vec4"),
    dark: uniform(1),
    /** The lamp, frame units, and its height over the frame. */
    lamp: uniform(new Vector3(0.4, 0.2, 0.35)),
    /** How bright the glow is: 1 at rest, lifting with the owner's writes. */
    glow: uniform(1),
  };
}
export type OrbUniforms = ReturnType<typeof orbUniforms>;

/** A four-colour ramp over `t`, eased between `STOPS`. */
const ramp = ([a, b, c, d]: readonly [V3, V3, V3, V3], t: F): V3 =>
  mix(
    mix(mix(a, b, smoothstep(STOPS[0], STOPS[1], t)), c, smoothstep(STOPS[1], STOPS[2], t)),
    d,
    smoothstep(STOPS[2], STOPS[3], t),
  );

/** The frame, for `scene.backgroundNode`. */
export function orbFrame(
  u: OrbUniforms,
  scrim: ReturnType<typeof textScrim>,
  { ground, page, paint }: Grounds,
): V3 {
  return Fn(() => {
    const aspect = screenSize.x.div(screenSize.y);
    const p = vec2(screenUV.x.sub(0.5).mul(aspect), float(0.5).sub(screenUV.y)).toVar();
    const lampAt = p.sub(u.lamp.xy);
    const near = exp(dot(lampAt, lampAt).mul(-0.8));
    const quiet = scrim.under(vec2(screenUV.x, float(1).sub(screenUV.y)));

    let night: V3 = ground.add(mix(FIELD, FIELD_LIT, near));
    let day: V3 = mix(WASH, vec3(1, 1, 1), screenUV.y.oneMinus().mul(0.4));
    // Back to front: the last orb is farthest.
    for (let i = ORBS - 1; i >= 0; i--) {
      const orb = u.orbs.element(i);
      const off = p.sub(orb.xy);
      const edge = length(off).sub(orb.z);
      const out = normalize(off.add(1e-5));
      // The sphere: its normal, lit from the lamp as its centre sees it (a broad, even
      // gradient across the whole orb, never a hot spot where the lamp passes close).
      const q = off.div(orb.z);
      const normal = vec3(q, sqrt(max(float(1).sub(dot(q, q)), 0)));
      const toLamp = u.lamp.sub(vec3(orb.xy, 0));
      const falloff = float(1).div(dot(toLamp, toLamp).mul(0.8).add(1));
      const light = dot(normal, normalize(toLamp))
        .mul(falloff.mul(0.5).add(0.5))
        .mul(orb.w)
        .toVar();
      const limb = max(dot(out, normalize(toLamp.xy)), 0).toVar();
      const rim = pow(float(1).sub(normal.z), 2).mul(limb).mul(orb.w);
      const soft = mix(0.035, 0.01, smoothstep(0, 0.5, light));
      const cover = smoothstep(soft, soft.negate(), edge).toVar();
      const spill = exp(max(edge, 0).div(-0.1))
        .mul(limb.mul(0.75).add(0.25))
        .mul(orb.w)
        .mul(u.glow)
        .mul(float(1).sub(cover));

      const sphere = ramp([DEEP, VIOLET, ROSE, PEACH], light)
        .add(PEACH.mul(rim.mul(0.6)))
        .add(LILAC_RIM.mul(pow(float(1).sub(normal.z), 3).mul(float(1).sub(limb)).mul(0.35)))
        .mul(u.glow.mul(0.15).add(0.85))
        .mul(mix(0.4, 1, orb.w));
      night = mix(night, sphere, cover).add(mix(VIOLET, ROSE, limb).mul(spill.mul(0.28)));
      const pastel = ramp([LILAC, PERIWINKLE, BLUSH, CREAM], light)
        .add(CREAM.mul(rim.mul(0.3)))
        .min(1);
      day = mix(mix(day, pastel, cover), day.mul(BLUSH), spill.mul(0.4));
    }

    const shownDark = night.mul(float(1).sub(quiet.mul(0.15)));
    const shownLight = paint(page.mul(mix(day, vec3(1, 1, 1), quiet.mul(0.2))));
    return mix(shownLight, shownDark, u.dark);
  })();
}
