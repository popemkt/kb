/**
 * Gradient orbs' shader (T1): two great spheres floating in front of a deep
 * blue field, after the owner's reference. One pass per pixel and no
 * offscreen picture: three circles' distance fields, each shaded as a
 * sphere and laid over the ones behind it, over far orbs seeded a few to a
 * pixel's neighbourhood, so it is among the lightest of the GPU backdrops.
 *
 * - **Two layers.** The field is the background: deep blue air lit by the
 *   orbs' glows, far orbs out of focus in it, and the shadows the great
 *   orbs cast on it. It is full-bleed across the scroll region: a few large
 *   far orbs are seeded one to a broad cell in heights (`farOrbsAt`), so a
 *   wider frame adds more, some cells showing a soft disc and every one
 *   lighting the field about it with a glow wider than tall, shrunk until
 *   it clears the frame's bottom; the field is their union and the great
 *   orbs' own glows (`glowAbout`), so its lower edge is their round glows,
 *   never a band or an ellipse. Each far orb fades whole by where it stands
 *   (`farField`), and the field's light falls away from the great orbs in
 *   heights. The great orbs lie above it: nothing fades them, not even the
 *   text scrim, and only the frame's top cuts them (`orbs.ts`).
 * - **An orb** is its circle's signed distance. Inside it, the offset from
 *   the centre against the radius is a sphere's profile, which gives a
 *   normal; one key, high toward the side its lit limb faces (`lits`, the
 *   lamp leaning it), lights it, wrapped (half Lambert), so the light falls
 *   off smoothly across the whole face: deep blue in shadow through
 *   periwinkle and rose to cream on the lit side. No gloss, no hot spot, no
 *   bands; a limb softened as depth of field softens a large near shape.
 * - **What lifts an orb off the field**: Fresnel on its lit side only, the
 *   face brightening toward the limb there, never a line round it; a broad
 *   bloom off the lit limb into the field; a soft shadow it casts on the field, away from the
 *   lamp and wider than itself, and a darker contact where it crosses what
 *   is behind it; and depth: a farther orb is hazier and bluer, the
 *   farthest is far out of focus and belongs to the field, and each slides
 *   against the eye by its depth (`placeOrbs`).
 * - **The hue drifts**: the ramp's periwinkle, rose and cream lean toward
 *   indigo, magenta and amber and back on a slow clock (`hue`), and each
 *   load turns the whole a few degrees (`turn`, `hueTurn`).
 * - **Dark** pages paint the reference's palette over the deep blue field,
 *   warming toward the lamp. **Light** pages paint its pair: pastel cream,
 *   blush and lilac orbs over a periwinkle wash of the page's own paper,
 *   each in a lilac glow, their shadows lilac on it (`Grounds`).
 */
import {
  Fn,
  abs,
  cos,
  dot,
  exp,
  float,
  floor,
  fwidth,
  length,
  max,
  mix,
  normalize,
  screenSize,
  screenUV,
  sin,
  smoothstep,
  sqrt,
  step,
  uniform,
  uniformArray,
  vec2,
  vec3,
} from "three/tsl";
import { Matrix3, Vector3, Vector4 } from "three/webgpu";
import type { TslNode } from "@kb/scene-gpu";
import { dissolve, dissolveUniforms, type FarField } from "../gpu/dissolve";
import type { Grounds } from "../gpu/gpu-scene";
import type { textScrim } from "../gpu/text-scrim";
import { hash, hash2 } from "../gpu/noise";
import { ORBS } from "./orbs";

type F = TslNode<"float">;
type V2 = TslNode<"vec2">;
type V3 = TslNode<"vec3">;

/** The dark ramp (linear), shadow to highlight: the reference's deep blue, periwinkle, rose and cream. */
const BLUE = vec3(0.012, 0.03, 0.3);
const VIOLET = vec3(0.1, 0.12, 0.62);
const PINK = vec3(0.92, 0.4, 0.44);
const CREAM = vec3(1.15, 0.8, 0.62);
/** Where the hue leans to and back: indigo, magenta, amber. */
const INDIGO = vec3(0.07, 0.05, 0.42);
const MAGENTA = vec3(0.8, 0.22, 0.48);
const AMBER = vec3(1.15, 0.64, 0.48);
/** How out of focus an orb is at its limb (shares of its radius): the nearest a little, the farthest far. */
const NEAR_SOFT = 0.012;
const FAR_SOFT = 0.9;
/** How far an orb's shadow falls from it, away from the lamp, and how wide its penumbra is (shares of its radius). */
const SHADOW_FALL = 0.14;
const SHADOW_SOFT = 0.35;
/** The dark field: royal blue high and toward the lamp, deep navy low. */
const FIELD = vec3(0.014, 0.04, 0.3);
const FIELD_DEEP = vec3(0.003, 0.01, 0.1);
/** The light pair (shares of the paper): lilac shadow, periwinkle, blush and a cream highlight. */
const LILAC = vec3(0.6, 0.6, 0.95);
const PERIWINKLE = vec3(0.72, 0.66, 0.98);
const BLUSH = vec3(0.99, 0.74, 0.82);
const CREAM_INK = vec3(1.0, 0.9, 0.8);
const WASH = vec3(0.88, 0.9, 1.0);
/** Where the ramp's stops sit, over an orb's wrapped light (0 to 1): wide apart, so it is one gradient. */
const STOPS = [0.0, 0.42, 0.86, 1.08] as const;

/** Everything the CPU sets. Per orb: `orbs[i]` x y r light (frame units), `lits[i].xy` the way its lit limb faces, and `depths[i]`. */
export function orbUniforms(field: FarField) {
  const placed = Array.from({ length: ORBS }, () => new Vector4());
  const lit = Array.from({ length: ORBS }, () => new Vector4());
  const depth = Array.from({ length: ORBS }, () => 0);
  return {
    placed,
    lit,
    depth,
    orbs: uniformArray<"vec4">(placed, "vec4"),
    lits: uniformArray<"vec4">(lit, "vec4"),
    depths: uniformArray<"float">(depth, "float"),
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
    /** Each orb's glow, the field's reach round it. */
    reaches: Array.from({ length: ORBS }, () => dissolveUniforms()),
    /** Where the far orbs stand across the frame, each fading whole. */
    field,
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

/** The palette the hue has leaned to: periwinkle, rose and cream. */
interface Leaned {
  readonly violet: V3;
  readonly pink: V3;
  readonly cream: V3;
}

/** What has been painted behind an orb: the dark picture and the light one, and how much of it is a near orb. */
interface Behind {
  readonly night: V3;
  readonly day: V3;
  readonly held: F;
}

/** What an orb's shading reads of the pixel: where it is, how much of the field is there, and the hue. */
interface Pixel {
  readonly p: V2;
  readonly left: F;
  readonly hue: Leaned;
}

/**
 * Orb `i` over what is behind it (`below`). `left` is how much of the
 * field there is at the pixel: the farthest orb belongs to it and
 * dissolves with it; a near one never fades.
 */
function orbOver(u: OrbUniforms, i: number, { p, left, hue }: Pixel, below: Behind): Behind {
  const orb = u.orbs.element(i);
  const depth = u.depths.element(i);
  const near = depth.oneMinus();
  const off = p.sub(orb.xy);
  const edge = length(off).sub(orb.z);
  const out = normalize(off.add(1e-5));
  // The sphere: its normal, lit by one key high toward the side its lit limb faces, wrapped, so
  // the light falls off smoothly across the whole face to a cream crescent, never a band.
  const q = off.div(orb.z);
  const facing = sqrt(max(float(1).sub(dot(q, q)), 0));
  const normal = vec3(q, facing);
  const toward = u.lits.element(i).xy;
  const key = normalize(vec3(toward, u.lamp.z));
  const light = dot(normal, key).mul(0.5).add(0.5).pow(1.5).mul(orb.w).toVar();
  const limb = max(dot(out, toward), 0).toVar();
  // A soft limb, as a lens's depth of field leaves a large near shape: softer the farther, and
  // the farthest far out of focus.
  const soft = fwidth(edge)
    .mul(1.2)
    .add(orb.z.mul(mix(float(NEAR_SOFT), float(FAR_SOFT), depth.pow(3))));
  const cover = smoothstep(soft, soft.negate(), edge).toVar();
  const outside = max(edge, 0);
  // Fresnel on the lit side only: the face brightens toward its limb where the light wraps it,
  // and the shadowed limb stays dark, so no line outlines it.
  const back = facing
    .oneMinus()
    .pow(2.5)
    .mul(smoothstep(0.05, 0.75, limb))
    .mul(near);
  const backColour = mix(hue.pink, hue.cream, limb);
  // A deep bloom off the lit limb into the field, in its own light: broad and soft, never a ring.
  const bloom = exp(outside.div(orb.z.mul(-0.3)))
    .mul(0.16)
    .mul(limb.mul(limb).mul(0.9).add(0.1))
    .mul(orb.w)
    .mul(u.glow)
    .mul(float(1).sub(cover))
    .mul(near)
    // It lights the field, and dissolves with it.
    .mul(left);
  // Where it crosses what is behind it, the near orb darkens it: contact, close to its limb.
  const contact = float(1).sub(
    exp(outside.div(orb.z.mul(-0.1)))
      .mul(0.5)
      .mul(near),
  );
  // Atmosphere: the farther, the hazier and bluer, toward the field behind it.
  const sphere = mix(
    ramp([BLUE, hue.violet, hue.pink, hue.cream], light).add(backColour.mul(back.mul(0.4))),
    FIELD.mul(1.3),
    depth.mul(0.55),
  )
    .mul(u.glow.mul(0.15).add(0.85))
    .mul(mix(0.45, 1, orb.w));
  const shown = cover.mul(mix(float(1), left, depth));
  const glowColour = mix(hue.violet, mix(hue.pink, hue.cream, limb), limb);
  const night = mix(below.night.mul(contact), sphere, shown).add(glowColour.mul(bloom));
  const pastel = mix(
    ramp([LILAC, PERIWINKLE, BLUSH, CREAM_INK], light).add(back.mul(0.08)),
    WASH,
    depth.mul(0.55),
  ).min(1);
  // On paper the bloom is a lilac glow round it, so its limb sits in its own light, not on white.
  const day = mix(
    mix(below.day, below.day.mul(mix(LILAC, BLUSH, limb)), bloom.mul(1.4).min(0.6)),
    pastel,
    shown,
  );
  return { night, day, held: below.held.max(shown.mul(near)) };
}

/**
 * One layer of far orbs, seeded one to a cell across the frame (frame
 * units, so a wider frame adds more of the same): how wide a cell is, the
 * orbs' radii and the heights their centres rest between, how far past its
 * limb each one's glow lights the field (radii), how many cells show an
 * orb at all (every cell's glow lights the field), how lit and how present
 * one is against a near orb, how out of focus, and the layer's own seed.
 */
interface FarLayer {
  readonly cell: number;
  readonly radius: readonly [number, number];
  readonly rise: readonly [number, number];
  readonly halo: number;
  readonly shows: number;
  readonly light: number;
  readonly presence: number;
  readonly blur: number;
  readonly seed: number;
}

/** Large orbs far out of focus behind the great ones, few: one to a broad cell, under half of them shown. */
const FAR_LAYERS: readonly FarLayer[] = [
  {
    cell: 1.5,
    radius: [0.3, 0.55],
    rise: [0.12, 0.46],
    halo: 2.2,
    shows: 0.45,
    light: 0.6,
    presence: 0.75,
    blur: 0.85,
    seed: 3.1,
  },
];
/** How many cells either side of a pixel's a far orb's glow may reach it from. */
const FAR_SPAN = 2;
/** How much wider than tall a far orb's glow is. */
const SPREAD = 2.6;
/** How far above the frame's bottom every far glow is gone (frame units). */
const FAR_CLEAR = 0.28;
/** How fast the field's light falls away from the great orbs, across (frame units): a wider frame adds a dimmer field. */
const FIELD_FALL = 2.6;

/** What the far orbs leave at a pixel: how much of the field their glows light, and their discs over it. */
interface FarOrbs {
  readonly glow: F;
  readonly cover: F;
  readonly night: V3;
  readonly day: V3;
}

/**
 * The far orbs at `p`: each a soft disc, out of focus and half lost in the
 * haze, lit toward the lamp; each lights the field about it by its own
 * round glow, shrunk until it clears the frame's bottom, and their union
 * is the field, so it is full-bleed across the frame and its lower edge is
 * their round glows. Each fades whole by where it stands (`farField`).
 */
function farOrbsAt(u: OrbUniforms, p: V2, hue: Leaned): FarOrbs {
  const none = float(1).toVar();
  const cover = float(0).toVar();
  const night = vec3(0, 0, 0).toVar();
  const day = vec3(1, 1, 1).toVar();
  for (const layer of FAR_LAYERS) {
    const home = floor(p.x.div(layer.cell));
    for (let k = -FAR_SPAN; k <= FAR_SPAN; k++) {
      const cell = home.add(k);
      const at = hash2(vec2(cell, layer.seed));
      const size = hash(vec2(cell.add(5.3), layer.seed));
      const own = hash(vec2(cell.add(11.9), layer.seed));
      const sway = u.time.mul(0.05).add(own.mul(6.283));
      const centre = vec2(
        cell.add(at.x.mul(0.7).add(0.15)).mul(layer.cell).add(sin(sway).mul(0.02)),
        mix(float(layer.rise[0]), float(layer.rise[1]), at.y).add(cos(sway.mul(0.8)).mul(0.015)),
      );
      const r = mix(float(layer.radius[0]), float(layer.radius[1]), size.mul(size));
      const standing = u.field.standing(centre, own).toVar();
      const off = p.sub(centre);
      const d = length(off);
      // Its glow spreads wider than it is tall, as light in a haze does, so the glows of
      // neighbouring cells run together across the frame.
      const halo = mix(float(0.35), float(1), hash(vec2(cell.add(31.4), layer.seed)));
      const reach = r.mul(halo.mul(layer.halo).add(1)).min(centre.y.add(0.5 - FAR_CLEAR));
      const spread = length(off.div(vec2(SPREAD, 1)));
      none.mulAssign(float(1).sub(smoothstep(reach, r.mul(0.3), spread).mul(standing)));
      // The disc, out of focus, lit on the side toward the lamp.
      const q = off.div(r);
      const normal = vec3(q, sqrt(max(float(1).sub(dot(q, q)), 0)));
      const key = normalize(vec3(normalize(u.lamp.xy.sub(centre).add(1e-5)), u.lamp.z));
      const light = dot(normal, key).mul(0.5).add(0.5).pow(1.5).mul(layer.light);
      const shows = step(hash(vec2(cell.add(23.1), layer.seed)), layer.shows);
      const shown = smoothstep(r, r.mul(1 - layer.blur), d)
        .mul(standing)
        .mul(shows.mul(layer.presence));
      const deep = mix(ramp([BLUE, hue.violet, hue.pink, hue.cream], light), FIELD.mul(1.3), 0.5);
      const pastel = mix(ramp([LILAC, PERIWINKLE, BLUSH, CREAM_INK], light), WASH, 0.55);
      night.assign(mix(night, deep, shown));
      day.assign(mix(day, pastel, shown));
      cover.assign(cover.add(shown.mul(cover.oneMinus())));
    }
  }
  return { glow: none.oneMinus(), cover, night, day };
}

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
    const near = exp(dot(lampAt, lampAt).mul(-4));
    const under = scrim.under(vec2(screenUV.x, float(1).sub(screenUV.y)));
    const hue: Leaned = {
      violet: mix(VIOLET, INDIGO, u.hue),
      pink: mix(PINK, MAGENTA, u.hue),
      cream: mix(CREAM, AMBER, u.hue),
    };

    // The field, the background layer: deep blue air, royal toward the top and the lamp, and the
    // shadows the nearer orbs cast on it, away from the lamp and wider than they are.
    const rise = smoothstep(-0.7, 0.55, p.y.add(p.x.sub(u.lamp.x).mul(0.2).clamp(-0.25, 0.25)));
    let shade: F = float(1);
    // How much of the field there is: the far orbs' glows and the great orbs', their union, each
    // dissolving by its own round reach.
    const far = farOrbsAt(u, p, hue);
    let none: F = far.glow.oneMinus();
    for (let i = 0; i < ORBS; i++) {
      const orb = u.orbs.element(i);
      const fallen = p.sub(orb.xy.sub(u.lits.element(i).xy.mul(orb.z.mul(SHADOW_FALL))));
      const cast = smoothstep(
        orb.z.mul(1 + SHADOW_SOFT),
        orb.z.mul(1 - SHADOW_SOFT * 0.5),
        length(fallen),
      );
      shade = shade.mul(float(1).sub(cast.mul(u.depths.element(i).oneMinus().mul(0.6))));
      const reach = u.reaches[i];
      if (reach !== undefined) none = none.mul(dissolve(reach, p, u.time.mul(0.01)).oneMinus());
    }
    const left = none.oneMinus().toVar();
    // The great orbs light the field: it dims away from them across the frame, never to nothing.
    const lit = exp(
      abs(p.x.sub(u.orbs.element(0).x))
        .div(FIELD_FALL)
        .negate(),
    )
      .mul(0.45)
      .add(0.55);
    const field: V3 = mix(FIELD_DEEP, FIELD, rise.mul(lit))
      .mul(shade)
      .add(mix(hue.violet, hue.pink, 0.6).mul(near.mul(0.05)));
    const wash: V3 = mix(
      mix(WASH, vec3(1, 1, 1), rise.oneMinus().mul(0.35).add(lit.oneMinus().mul(0.3))),
      LILAC.mul(0.92),
      shade.oneMinus().mul(0.45),
    );
    // Back to front: the last orb is the farthest, and belongs to the field.
    let behind: Behind = {
      night: mix(field.mul(left), far.night, far.cover),
      day: mix(mix(vec3(1, 1, 1), wash, left), far.day, far.cover),
      held: float(0),
    };
    const pixel = { p, left, hue };
    for (let i = ORBS - 1; i >= 0; i--) behind = orbOver(u, i, pixel, behind);
    // The scrim quiets the field under the text, never a great orb in front of it.
    const quiet = under.mul(behind.held.oneMinus());

    const shownDark = ground.add(
      u.turn
        .mul(behind.night)
        .max(0)
        .mul(float(1).sub(quiet.mul(0.15))),
    );
    const shownLight = paint(
      page.mul(mix(u.turn.mul(behind.day).min(1), vec3(1, 1, 1), quiet.mul(0.2))),
    );
    return mix(shownLight, shownDark, u.dark);
  })();
}
