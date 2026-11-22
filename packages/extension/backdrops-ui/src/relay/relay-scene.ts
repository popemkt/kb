import { water } from "./water";
import { quayInput } from "./quay-input";
import type { SceneStage, TslNode } from "@kb/scene-gpu";
import {
  AdditiveBlending,
  Box3,
  Vector2,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicNodeMaterial,
  LineSegments,
  Mesh,
  PlaneGeometry,
} from "three/webgpu";
import {
  exp,
  fog,
  fract,
  length,
  mix,
  mx_noise_float,
  positionGeometry,
  rangeFogFactor,
  screenUV,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import { seededRng } from "../scene/rng";
import { finishes, flat } from "./finishes";
import { buildHarbour, EAVE_LAMPS } from "./harbour";
import { buildSwitchboard } from "./switchboard";

import { mountBackdrop, type GpuBackdropInit, type BackdropParts } from "../gpu/gpu-scene";
import { seaMist, lampShaft } from "./sea-mist";
import { windsock } from "./windsock";

const FOCUS = { distance: 7.4, depth: 1.45, falloff: 5, radius: 2.3 };

type Scalar = TslNode<"float">;
function rainfall(time: Scalar, seed: number) {
  const rng = seededRng(seed);
  const points: number[] = [];
  for (let i = 0; i < 850; i++) {
    const x = rng.range(-8, 8),
      z = rng.range(-8, 2.8),
      y = rng.range(4.8, 5.1);
    const size = rng.range(0.038, 0.11);
    points.push(x, y, z, x + 0.22 * size, y + size, z);
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(points, 3));
  const mat = new LineBasicNodeMaterial({ transparent: true, depthWrite: false });
  const depth = positionGeometry.z;
  const phase = fract(time.mul(0.9).add(depth.mul(7.36)));
  const falling = positionGeometry.sub(vec3(phase.mul(1.21), phase.mul(5.35), 0));
  mat.positionNode = falling;
  const near = smoothstep(-5, 2, depth);
  mat.colorNode = mix(vec3(0.53, 0.57, 0.34), vec3(0.4, 0.63, 0.72), near);
  const litDrop = exp(length(falling.xy.sub(vec2(-3.32, 2.1))).mul(-0.9));
  mat.opacityNode = near.mul(0.074).add(0.024).add(litDrop.mul(0.35));
  return new LineSegments(geo, mat);
}

/** Thin illuminated mist in front of the light sources. The smooth falloff
 * keeps the air visible several letters away from the fluorescent tubing. */
function lightMist(tint: TslNode<"vec3">, intensity: Scalar, size: [number, number]) {
  const radius = length(uv().sub(0.5).mul(2));
  const mat = flat(tint);
  mat.transparent = true;
  mat.depthWrite = false;
  mat.blending = AdditiveBlending;
  mat.opacityNode = smoothstep(0, 1, radius).oneMinus().pow(2).mul(intensity);
  return new Mesh(new PlaneGeometry(...size), mat);
}

function cue(t: number, start: number, end: number, edge: number) {
  const ease = (v: number) => {
    const k = Math.min(1, Math.max(0, v / edge));
    return k * k * (3 - 2 * k);
  };
  return ease(t - start) * ease(end - t);
}

function exchange(stage: SceneStage, init: GpuBackdropInit): BackdropParts {
  const time = uniform(0),
    ring = uniform(0),
    answer = uniform(0);
  const f = finishes(stage, ring, answer);
  const root = new Group();
  stage.scene.add(root);
  buildHarbour(root, f);
  const { bank, lever, needle } = buildSwitchboard(root, f);
  const fabric = windsock(root);
  const neonAir = lightMist(vec3(0.7, 0.86, 0.12), uniform(0.28), [6.4, 2.1]);
  neonAir.position.set(-3.3, 2.8, -2.05);
  const amberAir = lightMist(vec3(1.0, 0.36, 0.07), ring.mul(0.44), [2.4, 2.1]);
  amberAir.position.set(1.33, 2.53, 0.61);
  root.add(neonAir, amberAir);
  const canal = water(time);
  const input = quayInput(new Box3().setFromObject(bank), canal.splash);
  const viewport = new Vector2(1, 1);
  let callStart = 0;
  const rain = rainfall(time, init.seed);
  root.add(canal.surface, rain, seaMist(time, answer, -5.5), seaMist(time, answer, -1.95));
  for (const x of EAVE_LAMPS) root.add(lampShaft(x, time));
  const mist = mix(vec3(0.038, 0.072, 0.092), stage.colors.ground, 0.054);
  const cloud = mx_noise_float(vec3(screenUV.mul(vec2(4.7, 2.1)), time.mul(0.027)));
  stage.scene.backgroundNode = mix(vec3(0.008, 0.018, 0.045), mist, screenUV.y)
    .add(
      vec3(0.25, 0.255, 0.061).mul(
        exp(length(screenUV.sub(vec2(0.22, 0.61)).mul(vec2(1.35, 1))).mul(-3.4)),
      ),
    )
    .add(vec3(0.06, 0.084, 0.094).mul(cloud));
  stage.scene.fogNode = fog(mist, rangeFogFactor(8, 21));
  let elapsed = 0;
  return {
    panel: { x: 0.31, y: 0.47, scale: 0.7, presence: 1 },
    wide: { x: 0.42, y: 0.47, scale: 1, presence: 1 },
    layout({ anchor, quality, width, height }) {
      viewport.set(width, height);
      const depth = 7.25 / anchor.scale;
      const viewHeight = 2 * depth * Math.tan((27.3 * Math.PI) / 360);
      const x = 1.46 - anchor.x * viewHeight,
        y = 1.5 - anchor.y * viewHeight;
      stage.setFocus({ ...FOCUS, distance: depth });
      stage.camera.position.set(x + 0.82, y + 0.18, depth + 0.08);
      stage.camera.lookAt(x, y, -0.1);
      stage.camera.updateMatrixWorld();
      rain.geometry.setDrawRange(0, 2 * Math.round(850 * quality));
      return anchor;
    },
    setLook(look) {
      stage.setBloom(look.dark ? 0.31 : 0.22);
    },
    frame(dt, reactions) {
      elapsed += dt;
      const t = stage.reduced() ? 4.9 : elapsed;
      if (input(reactions.pointer, stage.camera, viewport, t, dt)) callStart = t - 0.64;
      const beat = stage.reduced() ? 4.9 : (t - callStart) % 9;
      time.value = t;
      fabric(t);
      ring.value = cue(beat, 1.0, 1.66, 0.13) + cue(beat, 2.06, 2.96, 0.17);
      answer.value = cue(beat, 3.65, 7.5, 0.53);
      lever.rotation.z = -0.58 + cue(beat, 0.65, 3.22, 0.39) * 0.99;
      needle.rotation.z = 0.88 - ring.value * 1.46 - answer.value * 0.74 - reactions.stir * 0.24;
    },
    dispose: canal.dispose,
  };
}
export function mountRelay(host: HTMLElement, init: GpuBackdropInit) {
  return mountBackdrop(
    host,
    init,
    {
      projection: { kind: "perspective", fov: 27.3 },
      bloom: { strength: 0.31, radius: 0.25 },
      focus: FOCUS,
      lens: { aberration: 0, streak: 0.035, grain: 0.008 },
      fadeSpace: "display",
      feather: { sides: 0.08, top: 0.045, bottom: 0.27 },
    },
    exchange,
  );
}
