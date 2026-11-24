import type { TslNode } from "@kb/scene-gpu";
import { AdditiveBlending, Mesh, PlaneGeometry } from "three/webgpu";
import {
  exp,
  length,
  mix,
  mx_noise_float,
  positionWorld,
  smoothstep,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import { flat } from "./finishes";

/** A bank of sea mist seen edge-on. The feathered density and lighting live
 * in world space, so the distant bank and its planar reflection agree. */
export function seaMist(time: TslNode<"float">, answer: TslNode<"float">, depth: number) {
  const p = positionWorld;
  const flow = vec3(p.x.mul(0.44).sub(time.mul(0.065)), p.y.mul(2.3), depth);
  const billow = mx_noise_float(flow)
    .mul(0.68)
    .add(mx_noise_float(flow.mul(2.35)).mul(0.22));
  const density = smoothstep(-0.44, 0.37, billow.sub(uv().y.mul(0.44)));
  const height = smoothstep(0, 0.18, uv().y).mul(smoothstep(0.14, 0.96, uv().y).oneMinus());
  const shop = exp(length(p.xy.sub(vec2(-3.45, 0.78)).mul(vec2(0.49, 0.78))).mul(-0.9));
  const hue = mix(vec3(0.11, 0.29, 0.36), vec3(0.7, 0.74, 0.3), shop);
  const reply = exp(length(p.xy.sub(vec2(-3.9, 0.72))).mul(-1.75)).mul(answer);
  const air = flat(hue.add(vec3(0.65, 0.26, 0.05).mul(reply)));
  air.transparent = true;
  air.depthWrite = false;
  air.opacityNode = density.mul(height).mul(0.34);
  const layer = new Mesh(new PlaneGeometry(26, 1.85), air);
  layer.position.set(0, 0.81, depth);
  return layer;
}

/** Light scattered by rain beneath a hooded practical. The pool widens
 * downwards and breaks up in the same wind that pushes mist over the bank. */
export function lampShaft(x: number, time: TslNode<"float">) {
  const fall = uv().y.oneMinus();
  const axis = uv().x.sub(0.5).sub(fall.mul(0.07));
  const width = fall.mul(0.33).add(0.13);
  const edge = smoothstep(0.12, 1, axis.abs().div(width)).oneMinus();
  const drift = mx_noise_float(
    vec3(positionWorld.x.mul(3.5).sub(time.mul(0.25)), positionWorld.y.mul(0.85), x),
  );
  const air = flat(vec3(1.05, 0.79, 0.29));
  air.transparent = true;
  air.depthWrite = false;
  air.blending = AdditiveBlending;
  air.opacityNode = edge.mul(uv().y.pow(1.3)).mul(drift.mul(0.07).add(0.14));
  const shaft = new Mesh(new PlaneGeometry(1.36, 1.89), air);
  shaft.position.set(x, 1.28, -2.4);
  return shaft;
}
