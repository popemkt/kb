/**
 * The medallion's eyes: a light deep in each socket the relief sinks where
 * it glows (`relief.ts`), lighting the steel round it as any light does.
 *
 * - **The core** is the glow itself, by its heat (`relief.ts`): hottest and
 *   near white deepest in it, falling to the light's own colour at its
 *   edge, whatever the glow's size or shape. It lies at the socket's
 *   bottom, below the face (`CORE`): seen through the socket's mouth, it
 *   sits low in it, the brow over it hiding its top, and it shifts against
 *   the mouth as the medallion leans, so it reads as deep, not drawn on.
 * - **The socket and the metal by it** take its light by their normals
 *   (`socketLight`): the baked flux, its direction and its strength falling
 *   with the square of distance, through the steel's own reflectance, a
 *   GGX lobe as rough as its grime (widened by the pixel's own spread, the
 *   steel's specular AA) and a little diffuse where patina is. A wall that
 *   faces the light is lit, a face turned from it or above it is not, and
 *   where the relief stands between them the bake hid the light already.
 * - **The halo** is that light's strength from every side, in the air: it
 *   bleeds out from the socket where the light reaches, and where a brow
 *   hides the light it hides the halo too. On a dark page the stage's bloom
 *   takes the core's hot light further.
 * - **It breathes** while the medallion senses the page: a faint flicker,
 *   stronger as its eyes wake, on the scene's clock, so a still frame is
 *   still.
 */
import { dot, float, max, mix, normalize, pow, smoothstep, vec2, vec3 } from "three/tsl";
import { Vector2 } from "three/webgpu";
import type { TslNode } from "@kb/scene-gpu";
import { gnoise } from "../gpu/noise";

type F = TslNode<"float">;
type V2 = TslNode<"vec2">;
type V3 = TslNode<"vec3">;
type V4 = TslNode<"vec4">;

/** The core's heart, near white, warmer than the light it gives. */
const WHITE_HOT = vec3(1, 0.86, 0.6);
/**
 * How bright the core is at its heart (at a flare) and how much of that
 * its edge keeps; its light on the steel; its halo in the air; and how much
 * of the steel's patina scatters it.
 */
const EYE = { core: 4, edge: 0.15, shine: 1.5, halo: 0.03, diffuse: 0.35 } as const;
/**
 * How deep the core lies: how far below the socket's mouth it shows (the
 * brow over it, medallion units), and how far it shifts against the mouth
 * for a medallion unit of lean.
 */
const CORE = { low: new Vector2(0, 0.022), parallax: 0.5 } as const;

/** Where the core shows through the socket's mouth at a point, for `lean` (`MedallionUniforms.lean`): the point the heat is read from, as an offset. */
export const coreSight = (lean: V2): V2 =>
  vec2(CORE.low.x, CORE.low.y).add(lean.mul(CORE.parallax));

/** What the steel is where the eyes' light falls on it. */
export interface EyeSurface {
  readonly normal: V3;
  /** How far its normal turns across the pixel (a slope's variance). */
  readonly spread: F;
  /** Its reflectance at normal incidence (a metal's colour). */
  readonly albedo: V3;
  readonly grime: F;
}

/**
 * The eyes at a point: `light` the baked flux there (`BakedRelief.light`),
 * `heat` how hot the relief's glow is there and `deep` at the core seen
 * through it (read `coreSight` away), `power` how bright the eyes are
 * (`MedallionUniforms.glow`), `time` the scene's clock. Their light on the
 * steel (`shine`), the core's own light (`core`) and the halo (`halo`), each
 * white: the caller tints them.
 */
export function socketLight(
  surface: EyeSurface,
  {
    light,
    heat,
    deep,
    power,
    time,
  }: {
    readonly light: V4;
    readonly heat: F;
    readonly deep: F;
    readonly power: F;
    readonly time: F;
  },
) {
  const view = vec3(0, 0, 1);
  const { normal, spread, albedo, grime } = surface;
  // Awake, the eyes waver a little: two slow noises, never a strobe.
  const waver = gnoise(vec2(time.mul(1.7), 3.1))
    .add(gnoise(vec2(time.mul(4.3), 8.9)).mul(0.5))
    .sub(0.75)
    .mul(power.mul(0.12).add(0.04));
  const strength = power.mul(waver.add(1)).toVar();
  const toLight = normalize(light.xyz.add(vec3(0, 0, 1e-5)));
  const facing = max(dot(normal, light.xyz), 0);
  // GGX, as rough as the steel's grime, its lobe widened by the pixel's spread.
  const rough = mix(float(0.3), float(0.7), grime);
  const a2 = rough.mul(rough).add(spread.mul(2));
  const half = normalize(toLight.add(view));
  const nh = max(dot(normal, half), 0);
  const lobe = nh.mul(nh).mul(a2.sub(1)).add(1);
  const ggx = a2.div(lobe.mul(lobe).mul(Math.PI));
  const fresnel = albedo.add(
    vec3(1, 1, 1)
      .sub(albedo)
      .mul(pow(float(1).sub(max(dot(half, view), 0)), 5)),
  );
  const reflected = fresnel.mul(ggx.mul(0.25)).add(albedo.mul(grime.mul(EYE.diffuse / Math.PI)));
  const shine = reflected.mul(facing.mul(EYE.shine)).mul(strength);
  // The core shows only through the socket's mouth, where the relief glows.
  const heart = smoothstep(0.5, 1, deep);
  const core = smoothstep(0.05, 0.5, deep)
    .mul(smoothstep(0.02, 0.3, heat))
    .mul(mix(float(EYE.edge), float(1), heart))
    .mul(EYE.core)
    .mul(strength);
  const white = heart.mul(heart);
  return {
    shine,
    core,
    /** How far the core's colour runs toward white at its heart. */
    white,
    halo: light.w.mul(EYE.halo).mul(strength),
  };
}

/** The colour of the eyes' light where it is `white` toward the heart, from `tint`. */
export const coreColour = (tint: V3, white: F): V3 => mix(tint, WHITE_HOT, white);
