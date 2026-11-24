import { Mesh, PlaneGeometry, Vector3 } from "three/webgpu";
import {
  reflector,
  positionWorld,
  screenUV,
  mx_noise_float,
  vec2,
  vec3,
  sin,
  exp,
  dot,
  fract,
  length,
  mix,
  smoothstep,
  uniform,
  float,
} from "three/tsl";
import type { TslNode } from "@kb/scene-gpu";
import { flat } from "./finishes";
type Scalar = TslNode<"float">;
export function water(time: Scalar, daylight: Scalar) {
  const mirror = reflector({ resolutionScale: 0.5, generateMipmaps: true, bounces: false });
  const p = positionWorld.xz;
  const swell = mx_noise_float(vec3(p.x.mul(2.4), p.y.mul(7.2), time.mul(0.46)));
  const chop = sin(p.y.mul(53).add(time.mul(2.4)).add(swell.mul(4)));
  // Expanding impact rings contribute a signed radial slope, so the actual
  // reflected objects bend to either side of each crest.
  const lattice = p.mul(3.4);
  const seed = fract(sin(dot(lattice.floor(), vec2(18.62, 77.93))).mul(4165.23));
  const age = fract(time.mul(0.58).add(seed));
  const offset = fract(lattice).sub(vec2(seed.mul(0.5).add(0.25), 0.5));
  const r = length(offset);
  const wave = r.sub(age.mul(0.47));
  const slope = sin(wave.mul(73))
    .mul(exp(wave.abs().mul(-24)))
    .mul(age.oneMinus());
  const drops = Array.from({ length: 4 }, () => uniform(new Vector3(0, 0, -10)));
  let wake: TslNode<"vec2"> = vec2(0);
  let glints: Scalar = float(0);
  for (const drop of drops) {
    const dropAge = time.sub(drop.z).max(0);
    const delta = p.sub(drop.xy);
    const distance = length(delta);
    const crest = distance.sub(dropAge.mul(0.96));
    const envelope = exp(crest.abs().mul(-6))
      .mul(smoothstep(0, 0.12, dropAge))
      .mul(smoothstep(0.55, 1.45, dropAge).oneMinus());
    const wakeSlope = sin(crest.mul(36)).mul(envelope);
    wake = wake.add(delta.div(distance.max(0.001)).mul(wakeSlope));
    glints = glints.add(wakeSlope.max(0));
  }
  const dx = swell.mul(0.0025).add(offset.x.mul(slope).mul(0.009));
  const dy = chop.mul(0.0018).add(swell.mul(0.008)).add(offset.y.mul(slope).mul(0.012));
  mirror.uvNode = screenUV.flipX().add(vec2(dx, dy)).add(wake.mul(0.017)).clamp(0.001, 0.999);
  mirror.levelNode = swell
    .abs()
    .mul(1.3)
    .add(smoothstep(-7, 1, p.y).oneMinus().mul(1.5))
    .add(0.38);
  // Cool body colour shows through between reflections. Bright reflected
  // lamps retain more of their own spectrum than the shaded water.
  const highlight = smoothstep(0.15, 0.9, mirror.rgb.dot(vec3(0.213, 0.715, 0.072)));
  const body = mix(vec3(0.012, 0.073, 0.083), vec3(0.021, 0.14, 0.14), swell.mul(0.45).add(0.5));
  const mat = flat(
    mix(mix(body, vec3(0.1, 0.27, 0.3), daylight), mirror.rgb, highlight.mul(0.38).add(0.55))
      .add(slope.max(0).mul(0.018))
      .add(vec3(0.22, 0.52, 0.5).mul(glints).mul(0.45)),
  );
  const surface = new Mesh(new PlaneGeometry(65, 55), mat);
  surface.rotation.x = -Math.PI / 2;
  surface.position.set(0, -0.055, -6);
  surface.add(mirror.target);
  let next = 0;
  return {
    surface,
    dispose: () => mirror.dispose(),
    splash: (x: number, z: number, t: number) => {
      drops[next]?.value.set(x, z, t);
      next = (next + 1) % drops.length;
    },
  };
}
