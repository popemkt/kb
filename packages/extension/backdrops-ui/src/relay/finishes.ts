import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs,
  dot,
  exp,
  float,
  fract,
  fwidth,
  length,
  mix,
  mx_noise_float,
  normalView,
  normalWorld,
  positionViewDirection,
  positionWorld,
  screenUV,
  viewportSharedTexture,
  sin,
  smoothstep,
  vec3,
} from "three/tsl";
import type { SceneStage, TslNode } from "@kb/scene-gpu";

type Pigment = TslNode<"vec3">;
type Scalar = TslNode<"float">;
export function flat(colour: Pigment) {
  const m = new MeshBasicNodeMaterial();
  m.colorNode = colour;
  return m;
}

/** Give a painted boundary at least one pixel of transition on a small header. */
function paintStep(value: Scalar, threshold: number, softness: number) {
  const width = fwidth(value).mul(0.65).max(softness);
  return smoothstep(width.negate(), width, value.sub(threshold));
}

/** Light falls away across the room; the work lamp pools at the sill. */
function replyLight(answer: Scalar) {
  const offset = positionWorld.sub(vec3(-3.83, 1.39, -2.93));
  const pool = exp(length(offset.mul(vec3(2.4, 1.65, 1.4))).mul(-1.35));
  return mix(vec3(0.013, 0.026, 0.032), vec3(1.92, 0.87, 0.21), pool.mul(answer));
}
function stationFinishes(bands: Scalar, streak: Scalar, grain: Scalar) {
  const p = positionWorld;
  // The back wall uses a staggered course with dark mortar and washed lime deposits.
  const row = p.y.mul(4.3);
  const seam = fract(p.x.mul(2.1).add(row.floor().mod(2).mul(0.5)));
  const mortar = smoothstep(0.0, 0.05, seam).mul(smoothstep(0.0, 0.09, fract(row)));
  const bricks = flat(
    mix(vec3(0.04, 0.05, 0.054), vec3(0.2, 0.245, 0.194).mul(bands), mortar)
      .mul(streak.mul(0.42).add(1))
      .add(grain.mul(0.014)),
  );
  const ridges = abs(sin(p.x.mul(48)));
  const roofing = flat(
    mix(
      vec3(0.029, 0.053, 0.063),
      vec3(0.12, 0.22, 0.2),
      ridges.mul(0.65).add(streak.mul(0.12)),
    ).mul(bands),
  );
  return {
    bricks,
    roofing,
    litPane: flat(
      mix(
        vec3(0.092, 0.12, 0.081),
        vec3(0.42, 0.51, 0.25),
        smoothstep(-0.1, 1.8, p.y).mul(0.83).add(streak.mul(0.13)),
      ).mul(grain.mul(0.055).add(1)),
    ),
    slate: flat(mix(vec3(0.017, 0.032, 0.054), vec3(0.046, 0.084, 0.102), bands.mul(0.65))),
  };
}

function valveGlass(rim: Scalar, ice: Pigment, lime: Pigment) {
  const p = positionWorld,
    normal = normalWorld;
  const glass = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const shine = dot(normal, vec3(-0.69, 0.29, 0.66)).smoothstep(0.9, 0.946);
  const band = dot(normal, vec3(0.81, 0.38, 0.45)).smoothstep(0.925, 0.964);
  glass.colorNode = mix(vec3(0.015, 0.24, 0.31), ice.mul(1.86), rim.add(shine).clamp(0, 1)).add(
    band.mul(lime).mul(0.68),
  );
  const beads = mx_noise_float(p.mul(vec3(138, 72, 138)));
  const drip = paintStep(beads.add(mx_noise_float(p.mul(vec3(30, 3, 30))).mul(0.21)), 0.6, 0.11);
  const glint = rim
    .add(drip.mul(0.3))
    .mul(0.8)
    .add(shine.mul(0.43))
    .add(band.mul(0.25))
    .add(0.095)
    .clamp(0, 0.95);
  const refracted = viewportSharedTexture(screenUV.add(normalView.xy.mul(0.009)));
  glass.backdropNode = refracted.rgb.mul(vec3(0.66, 0.89, 0.99));
  glass.backdropAlphaNode = glint.oneMinus();
  glass.opacityNode = float(0.93);
  return glass;
}

/** The sign at the left and the cyan sky at camera right pick out opposite
 * contours. All surface masks are evaluated on the actual mesh normals. */
export function finishes(stage: SceneStage, ring: Scalar, answer: Scalar) {
  const p = positionWorld;
  const normal = normalWorld;
  const lamp = vec3(-2, 3.0, -2).sub(p);
  const key = dot(normal, vec3(-0.48, 0.8, 0.36));
  const grain = mx_noise_float(p.mul(64));
  const flakes = mx_noise_float(p.mul(vec3(17, 28, 19)));
  const streak = mx_noise_float(p.mul(vec3(4.2, 0.52, 4.2)));
  const chipped = smoothstep(0.58, 0.81, flakes.add(streak.mul(0.38)));
  const rim = dot(normalView, positionViewDirection).clamp(0, 1).oneMinus().pow(3);
  const lime = vec3(1.05, 1.1, 0.32);
  const ice = vec3(0.19, 0.9, 1);
  const warm = lime
    .mul(rim)
    .mul(smoothstep(0.18, 0.65, dot(normal, lamp.normalize())))
    .mul(0.5);
  const cold = ice
    .mul(rim)
    .mul(smoothstep(0.36, 0.82, dot(normal, vec3(0.84, 0.36, -0.32))))
    .mul(0.55);
  const bands = paintStep(key.add(flakes.mul(0.035)), -0.177, 0.023)
    .mul(0.43)
    .add(paintStep(key.add(flakes.mul(0.028)), 0.487, 0.019).mul(0.68))
    .add(0.23);
  const inside = exp(length(p.sub(vec3(1.45, 1.35, 0.5))).mul(-2.2));
  function enamel(base: Pigment, wear: number, polish: number) {
    const worn = mix(base, vec3(0.117, 0.065, 0.041), chipped.mul(wear));
    const signPool = exp(length(p.sub(vec3(-3.1, 2.6, -2.25))).mul(-0.84));
    const damp = dot(normal, vec3(-0.27, 0.64, 0.71))
      .clamp(0, 1)
      .pow(27);
    const lit = worn
      .mul(bands)
      .mul(grain.mul(0.085).add(streak.mul(0.17)).add(1))
      .add(warm.add(cold).mul(polish))
      .add(damp.mul(polish).mul(vec3(0.18, 0.26, 0.25)))
      .add(lime.mul(signPool).mul(0.095))
      .add(
        replyLight(answer)
          .mul(exp(length(p.sub(vec3(-3.84, 1.0, -2.63))).mul(-1.3)))
          .mul(0.38),
      )
      .add(vec3(1, 0.26, 0.044).mul(inside).mul(ring).mul(0.27));
    return flat(lit);
  }
  const patina = paintStep(streak.mul(0.58).add(flakes.mul(0.42)), 0.28, 0.13);
  const copper = enamel(
    mix(vec3(0.45, 0.155, 0.057), vec3(0.04, 0.17, 0.15), patina.mul(0.82)),
    0.25,
    0.94,
  );
  const halfway = positionViewDirection.add(vec3(-0.58, 0.66, 0.48)).normalize();
  const sheen = normalView.dot(halfway).clamp(0, 1);
  const bakelite = flat(
    vec3(0.013, 0.023, 0.029)
      .mul(bands)
      .add(vec3(0.15, 0.22, 0.23).mul(sheen.pow(19)))
      .add(vec3(0.56, 0.76, 0.76).mul(sheen.pow(120)))
      .add(warm.mul(0.2)),
  );
  const porcelain = flat(
    vec3(0.44, 0.4, 0.54)
      .mul(bands)
      .add(cold.mul(0.47))
      .add(vec3(0.95, 0.94, 0.81).mul(sheen.pow(67))),
  );
  const violet = enamel(mix(vec3(0.128, 0.036, 0.25), stage.colors.hue, 0.08), 0.47, 0.75);
  const dark = enamel(vec3(0.022, 0.031, 0.052), 0.19, 0.25);
  const green = enamel(vec3(0.027, 0.098, 0.087), 0.86, 0.52);
  const foot = p.xz
    .sub(vec3(1.46, 0, 0.12).xz)
    .abs()
    .sub(vec3(0.79, 0, 0.51).xz)
    .max(0);
  const contact = exp(length(foot).mul(-8)).mul(smoothstep(0.09, 0.17, p.y).oneMinus());
  const stone = enamel(vec3(0.115, 0.14, 0.14).mul(contact.mul(-0.53).add(1)), 0.52, 0.33);
  const gold = enamel(vec3(0.56, 0.36, 0.115), 0.36, 0.85);
  const paper = enamel(vec3(0.6, 0.55, 0.35), 0.15, 0.45);
  const sign = flat(lime.mul(2.15));
  const workLight = flat(vec3(1.9, 1.15, 0.46));
  const tungsten = flat(vec3(1, 0.34, 0.058).mul(ring.mul(3.7).add(0.37)));
  const farWindow = flat(replyLight(answer));
  const pilot = flat(
    mix(
      vec3(0.022, 0.115, 0.092),
      mix(vec3(0.27, 1.5, 0.94), stage.colors.accent, 0.07),
      smoothstep(0.74, 0.98, answer),
    ),
  );
  const glass = valveGlass(rim, ice, lime);
  const masonry = stationFinishes(bands, streak, grain);
  return {
    copper,
    violet,
    dark,
    green,
    stone,
    gold,
    paper,
    sign,
    workLight,
    tungsten,
    farWindow,
    pilot,
    glass,
    ...masonry,
    ceramic: porcelain,
    bakelite,
    hemp: enamel(vec3(0.23, 0.145, 0.071).mul(grain.mul(0.29).add(1)), 0.14, 0.21),
    red: enamel(vec3(0.53, 0.089, 0.025), 0.36, 0.48),
    filament: flat(vec3(1, 0.51, 0.12).mul(float(0.4).add(ring.mul(4.2)))),
  };
}
export type Finishes = ReturnType<typeof finishes>;
