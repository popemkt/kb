/**
 * Gradient orbs' shader (T1): huge soft glowing spheres filling a deep blue
 * field, as the reference's fill its picture. One pass per pixel and no
 * offscreen picture: three circles' distance fields, each shaded as a
 * sphere and laid over the ones behind it, so it is among the lightest of
 * the GPU backdrops.
 *
 * - **An orb** is its circle's signed distance. Inside it, the offset from
 *   the centre against the radius is a sphere's profile, which gives a
 *   normal; one grazing key from the upper right, which the lamp leans,
 *   lights it. Its light runs one long, smooth ramp from the shadow's blue
 *   through violet and pink to a cream highlight on the lit limb: a broad
 *   gradient, never bands, and no gloss.
 * - **Very soft.** An orb's edge melts into the field, least where the key
 *   catches its limb; its glow spills past the lit limb and adds over
 *   whatever lies behind. Orbs are laid back to front (`orbs[0]`, the great
 *   orb, in front); one farther back is a little out of focus.
 * - **They blend by their glow.** The field is the orbs' own halo, deep
 *   blue and wide, so it fills the frame between them; where two halos
 *   overlap, as the orbs drift nearer, the field between them lifts toward
 *   violet, and dims again as they part. No shape joins them.
 * - **The hue drifts**: the ramp's violet, pink and cream lean toward
 *   indigo, magenta and amber and back on a slow clock (`hue`), and each
 *   load turns the whole a few degrees (`turn`, `hueTurn`).
 * - **It dissolves by its own shape** (`../gpu/dissolve`): the orbs lie
 *   whole in the frame, and the field dissolves at the ragged rim of a
 *   reach that fills it, never at a side of the frame.
 * - **Dark** pages paint the reference's palette over the deep blue field,
 *   warming toward the lamp. **Light** pages paint its pair: pastel cream,
 *   blush and lilac on a periwinkle wash of the page's own paper
 *   (`Grounds`).
 */
import {
  Fn,
  dot,
  exp,
  fwidth,
  float,
  length,
  max,
  mix,
  normalize,
  screenSize,
  screenUV,
  smoothstep,
  sqrt,
  uniform,
  uniformArray,
  vec2,
  vec3,
} from "three/tsl";
import { Matrix3, Vector3, Vector4 } from "three/webgpu";
import type { TslNode } from "@kb/scene-gpu";
import { dissolve, dissolveUniforms } from "../gpu/dissolve";
import { fbm4 } from "../gpu/noise";
import type { Grounds } from "../gpu/gpu-scene";
import type { textScrim } from "../gpu/text-scrim";
import { ORBS } from "./orbs";

type F = TslNode<"float">;
type V3 = TslNode<"vec3">;

/** The dark ramp (linear), shadow to highlight: the reference's blue, violet, pink and cream. */
const BLUE = vec3(0.05, 0.09, 0.62);
const VIOLET = vec3(0.3, 0.12, 0.74);
const PINK = vec3(0.9, 0.32, 0.4);
const CREAM = vec3(1.25, 0.9, 0.72);
/** Where the hue leans to and back: indigo, magenta, amber. */
const INDIGO = vec3(0.14, 0.12, 0.82);
const MAGENTA = vec3(0.78, 0.18, 0.6);
const AMBER = vec3(1.1, 0.68, 0.38);
/** The key light's direction: from the upper right, grazing, so the lit side is a crescent on the limb; the lamp only leans it. */
const KEY = vec3(0.74, 0.58, 0.3);
/** How much more an orb farther back is out of focus, per place behind the front one (frame units). */
const DEFOCUS = 0.02;
/** The dark field: a deep blue, darker between the orbs, warming toward the lamp. */
const FIELD = vec3(0.008, 0.022, 0.2);
const FIELD_DEEP = vec3(0.004, 0.009, 0.075);
const FIELD_LIT = vec3(0.07, 0.06, 0.32);
/** The light pair (shares of the paper): lilac shadow, periwinkle, blush and a cream highlight. */
const LILAC = vec3(0.6, 0.6, 0.95);
const PERIWINKLE = vec3(0.72, 0.66, 0.98);
const BLUSH = vec3(0.99, 0.74, 0.82);
const CREAM_INK = vec3(1.0, 0.9, 0.8);
const WASH = vec3(0.88, 0.9, 1.0);
/** Where the ramp's stops sit, over an orb's light (-1 to 1): wide apart, so it is one gradient. */
const STOPS = [-0.7, -0.05, 0.62, 1.05] as const;

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
    /** How far the hue leans, 0–1. */
    hue: uniform(0),
    /** This load's few degrees of hue: the picture turned about grey (`hueTurn`). */
    turn: uniform(new Matrix3()),
    time: uniform(0),
    /** The reach the orbs dissolve within. */
    reach: dissolveUniforms(),
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

    const left = dissolve(u.reach, p, u.time.mul(0.01));
    const violet = mix(VIOLET, INDIGO, u.hue);
    const pink = mix(PINK, MAGENTA, u.hue);
    const cream = mix(CREAM, AMBER, u.hue);
    // The field is the orbs' own halo, wide and deep blue, so it has their shapes and fills the
    // frame between them; where two halos overlap the field lifts toward violet.
    let halo: F = float(0);
    let most: F = float(0);
    for (let i = 0; i < ORBS; i++) {
      const orb = u.orbs.element(i);
      const edge = length(p.sub(orb.xy)).sub(orb.z);
      const h = exp(max(edge, 0).div(orb.z.mul(0.7).add(0.04)).negate());
      halo = halo.add(h);
      most = most.max(h);
    }
    // The deep field fills the whole reach; the orbs' halos lift it to royal blue round them.
    const field = smoothstep(0, 1, halo.min(1));
    const between = halo.sub(most).min(1);
    // Clouds in the field, slowly drifting, so its edge is theirs, never a shape of its own.
    const clouds = fbm4(p.mul(2.4).add(vec2(u.time.mul(0.012), u.time.mul(-0.008))))
      .mul(1.5)
      .add(0.15);
    let night: V3 = mix(FIELD_DEEP, mix(FIELD, FIELD_LIT, near), field)
      .mul(clouds)
      .add(violet.mul(between.mul(0.07)))
      // Toward the reach's rim the field thins where its clouds thin, so its edge is theirs.
      .mul(smoothstep(0.15, 0.9, left.mul(clouds)));
    let day: V3 = mix(
      WASH,
      vec3(1, 1, 1),
      screenUV.y.oneMinus().mul(0.4).add(float(1).sub(field).mul(0.5)),
    );
    day = mix(day, day.mul(PERIWINKLE), between.mul(0.25));
    // Back to front: the last orb is farthest.
    for (let i = ORBS - 1; i >= 0; i--) {
      const orb = u.orbs.element(i);
      const off = p.sub(orb.xy);
      const edge = length(off).sub(orb.z);
      const out = normalize(off.add(1e-5));
      // The sphere: its normal, lit by one key from the upper right that the lamp leans, so every
      // orb carries the same broad gradient, concentric to its lit limb, never a hot spot.
      const q = off.div(orb.z);
      const normal = vec3(q, sqrt(max(float(1).sub(dot(q, q)), 0)));
      const toLamp = normalize(u.lamp.sub(vec3(orb.xy, 0)));
      const key = normalize(KEY.add(toLamp.mul(0.35)));
      const light = dot(normal, key).mul(orb.w).toVar();
      const limb = max(dot(out, normalize(key.xy)), 0).toVar();
      // Soft all round, least where the key catches the limb; one farther back is out of focus.
      const aa = fwidth(edge);
      const soft = mix(orb.z.mul(0.09), aa.add(orb.z.mul(0.012)), smoothstep(0, 0.6, light)).add(
        DEFOCUS * i,
      );
      const cover = smoothstep(soft, soft.negate(), edge).toVar();
      const spill = exp(max(edge, 0).div(orb.z.mul(-0.3)))
        .mul(limb.mul(0.8).add(0.2))
        .mul(orb.w)
        .mul(u.glow)
        .mul(float(1).sub(cover));

      const sphere = ramp([BLUE, violet, pink, cream], light)
        .mul(u.glow.mul(0.15).add(0.85))
        .mul(mix(0.35, 1, orb.w));
      // The glow off the lit limb is the limb's own warm light, so its soft edge never mixes grey.
      const glowColour = mix(violet, mix(pink, cream, smoothstep(0.4, 0.9, limb)), limb);
      night = mix(night, sphere, cover).add(glowColour.mul(spill.mul(0.35)));
      const pastel = ramp([LILAC, PERIWINKLE, BLUSH, CREAM_INK], light).min(1);
      day = mix(mix(day, pastel, cover), day.mul(BLUSH), spill.mul(0.35));
    }

    const shownDark = ground.add(
      u.turn
        .mul(night)
        .max(0)
        .mul(left)
        .mul(float(1).sub(quiet.mul(0.15))),
    );
    const shownLight = paint(
      page.mul(
        mix(vec3(1, 1, 1), mix(u.turn.mul(day).min(1), vec3(1, 1, 1), quiet.mul(0.2)), left),
      ),
    );
    return mix(shownLight, shownDark, u.dark);
  })();
}
