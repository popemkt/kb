import {
  BufferGeometry,
  CatmullRomCurve3,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  PlaneGeometry,
  Vector3,
} from "three/webgpu";
import { exp, length, mix, smoothstep, uniform, uv, vec3 } from "three/tsl";
import type { TslNode } from "@kb/scene-gpu";
import { seededRng } from "../scene/rng";
import { flat } from "./finishes";

function sun() {
  const radius = length(uv().sub(0.5));
  const disc = smoothstep(0.122, 0.132, radius).oneMinus();
  const halo = exp(radius.mul(-9)).mul(smoothstep(0.34, 0.5, radius).oneMinus());
  const sunlight = mix(
    vec3(1.85, 1.06, 0.34),
    vec3(2.15, 1.8, 0.97),
    smoothstep(0.38, 0.62, uv().y),
  );
  const mat = flat(mix(vec3(1.45, 0.89, 0.39), sunlight, disc));
  mat.transparent = true;
  mat.depthWrite = false;
  mat.fog = false;
  mat.opacityNode = disc.mul(0.93).add(halo.mul(0.55)).clamp(0, 1);
  const sky = new Mesh(new PlaneGeometry(4.3, 4.3), mat);
  sky.position.set(-1.79, 4.6, -12.5);
  return sky;
}

type Point = [number, number, number];

/** Bake a thin tapered brush stroke along a curve. Its UV follows distance
 * along the stroke, so only a short travelling length ever catches light. */
function stroke(points: Point[], width: number, head: TslNode<"float">, lag: number) {
  const path = new CatmullRomCurve3(points.map((p) => new Vector3(...p)));
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const segments = 112;
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const p = path.getPointAt(u),
      tangent = path.getTangentAt(u);
    const radius = width * Math.sin(Math.PI * u);
    for (const side of [-1, 1]) {
      positions.push(p.x - side * radius * tangent.y, p.y + side * radius * tangent.x, p.z);
      uvs.push(u, (side + 1) / 2);
    }
    if (i > 0) {
      const k = 2 * i;
      indices.push(k - 2, k - 1, k, k, k - 1, k + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  const mat = flat(vec3(1.6, 1.64, 1.33));
  mat.transparent = true;
  mat.depthWrite = false;
  mat.side = DoubleSide;
  const behind = head.sub(lag).sub(uv().x);
  mat.opacityNode = smoothstep(0, 0.055, behind)
    .mul(smoothstep(0.12, 0.37, behind).oneMinus())
    .mul(0.69);
  return new Mesh(geometry, mat);
}

export function dayWeather(parent: Group, seed: number) {
  const sky = sun(),
    wind = new Group();
  const head = uniform(0);
  wind.add(
    stroke(
      [
        [3.5, 2.45, -0.7],
        [2.6, 2.26, -0.8],
        [1.2, 1.92, -0.85],
        [-0.25, 1.42, -0.78],
        [-1.55, 1.32, -0.7],
        [-2, 1.56, -0.7],
        [-1.79, 1.73, -0.7],
        [-1.62, 1.49, -0.7],
        [-2.18, 1.3, -0.7],
        [-3.8, 1.5, -0.8],
      ],
      0.022,
      head,
      0,
    ),
    stroke(
      [
        [2.8, 2.29, -0.85],
        [1.65, 1.87, -0.82],
        [0.45, 1.42, -0.78],
        [-0.62, 1.28, -0.7],
        [-1.27, 1.31, -0.7],
      ],
      0.016,
      head,
      0.12,
    ),
  );
  parent.add(sky, wind);
  const rng = seededRng(seed);
  let start = 1.6;
  return {
    setDaylight(day: boolean) {
      sky.visible = day;
    },
    update(t: number, still: boolean) {
      if (t > start + 3.1) start = t + rng.range(9, 17);
      const progress = (t - start) / 3.1;
      wind.visible = sky.visible && !still && progress >= 0 && progress < 1;
      if (!wind.visible) return 0;
      head.value = 1.5 * progress;
      return Math.sin(Math.PI * progress) ** 2;
    },
  };
}
