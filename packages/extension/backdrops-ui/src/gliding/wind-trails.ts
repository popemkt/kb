/**
 * Aerodynamic wingtip glide wind lines (`gliding-scene.ts`):
 * Short, whisper-delicate anime condensation slipstreams hugging ONLY the outer
 * wingtips (never cutting across the HUD or open ocean) that fade in briefly on
 * steeper banking or high glide speed, controllable via the `Wind trails` knob.
 */
import { clamp, float, mix, positionLocal, sin, smoothstep, uniform, uv, vec3 } from "three/tsl";
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
} from "three/webgpu";
import type { TslNode } from "@kb/scene-gpu";
import type { Grounds } from "../gpu/gpu-scene";

type V3 = TslNode<"vec3">;

const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = (r: number, g: number, b: number): V3 => vec3(lin(r / 255), lin(g / 255), lin(b / 255));

function makeScalarUniform(v: number) {
  return uniform(v);
}

type ScalarUniform = ReturnType<typeof makeScalarUniform>;

export interface WindTrailIntensity {
  readonly left: number;
  readonly right: number;
  readonly curl: number;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Pure deterministic wind-line intensity model:
 * - Silent (`0`) during calm straight cruise and reduced motion (zero stray white strips).
 * - Whispers in gracefully on the loaded wingtip when banking steeply (`|bankRoll| > 0.045`),
 *   on both wingtips when speeding up (`speedFactor > 1.18`), or during rare soft gusts.
 */
export function evaluateWindTrailIntensity(input: {
  readonly time: number;
  readonly bankRoll: number;
  readonly bankPitch: number;
  readonly speedFactor: number;
  readonly gain: number;
  readonly reducedMotion: boolean;
}): WindTrailIntensity {
  if (input.reducedMotion || input.gain <= 0.001) {
    return { left: 0, right: 0, curl: 0 };
  }
  const { time, bankRoll, bankPitch, speedFactor, gain } = input;
  const leanMag = Math.abs(bankRoll) + Math.abs(bankPitch) * 0.55;
  const leanBoost = clamp01((leanMag - 0.048) / 0.085);
  const speedBoost = clamp01((speedFactor - 1.18) / 0.8);

  // Rare, gentle wingtip condensation whispers (silent most of the time).
  const gustPortRaw = Math.sin(time * 0.34 + 1.1) * Math.sin(time * 0.14 + 2.3);
  const gustStbdRaw = Math.sin(time * 0.31 + 3.9) * Math.sin(time * 0.13 + 0.6);
  const gustLeft = clamp01((gustPortRaw - 0.62) / 0.34) * 0.42;
  const gustRight = clamp01((gustStbdRaw - 0.66) / 0.3) * 0.38;

  const portLean = clamp01((-bankRoll - 0.042) / 0.08) * 0.8 + leanBoost * 0.25;
  const stbdLean = clamp01((bankRoll - 0.042) / 0.08) * 0.8 + leanBoost * 0.25;

  const left = clamp01(Math.max(gustLeft, portLean, speedBoost * 0.78) * gain);
  const right = clamp01(Math.max(gustRight, stbdLean, speedBoost * 0.72) * gain);
  const curl = Math.max(-0.14, Math.min(0.14, bankRoll * 1.15));
  return { left, right, curl };
}

interface RibbonConfig {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly len: number;
  readonly hw: number;
  readonly uInt: ScalarUniform;
  readonly phase: number;
  readonly weight: number;
}

function buildWindRibbonGeometry(cfg: RibbonConfig): BufferGeometry {
  const segs = 16;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const y = cfg.y - t * cfg.len;
    const widthProfile = Math.sin(Math.min(1, t * 3.2) * Math.PI * 0.5) * (1 - t * 0.75);
    const hw = cfg.hw * Math.max(0.16, widthProfile);
    positions.push(cfg.x - hw, y, cfg.z, cfg.x + hw, y, cfg.z);
    uvs.push(0, t, 1, t);
    if (i < segs) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function createRibbonMaterial(
  cfg: RibbonConfig,
  shared: {
    readonly darkU: ScalarUniform;
    readonly timeU: ScalarUniform;
    readonly curlU: ScalarUniform;
  },
  grounds: Grounds,
): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial({
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
  });
  const st = uv();
  const sway = sin(st.y.mul(7.5).sub(shared.timeU.mul(6.8)).add(cfg.phase))
    .mul(0.009)
    .mul(st.y);
  const bendX = st.y.mul(st.y).mul(shared.curlU).add(sway);
  mat.positionNode = vec3(positionLocal.x.add(bendX), positionLocal.y, positionLocal.z);

  const across = float(1).sub(st.x.mul(2).sub(1).abs());
  const edgeSoft = smoothstep(0.0, 0.8, across);
  const headFade = smoothstep(0.0, 0.14, st.y);
  const tailFade = float(1).sub(smoothstep(0.22, 1.0, st.y));
  const streak = sin(st.y.mul(10.0).sub(shared.timeU.mul(9.0)).add(cfg.phase))
    .mul(0.22)
    .add(0.78);
  const alpha = clamp(
    edgeSoft
      .mul(headFade)
      .mul(tailFade)
      .mul(streak)
      .mul(cfg.uInt)
      .mul(cfg.weight * 0.5),
    0,
    0.72,
  );
  const col = mix(rgb(255, 255, 255), rgb(224, 246, 252), shared.darkU);
  mat.colorNode = grounds.paint(col);
  mat.opacityNode = alpha.mul(mix(float(0.72), float(0.92), shared.darkU));
  return mat;
}

export interface WindTrailsRig {
  readonly group: Group;
  readonly setLook: (opts: { readonly dark: boolean; readonly gain: number }) => void;
  readonly update: (opts: {
    readonly time: number;
    readonly bankRoll: number;
    readonly bankPitch: number;
    readonly speedFactor: number;
    readonly reducedMotion: boolean;
  }) => void;
  readonly dispose: () => void;
}

/** Create short, wispy wingtip slipstreams locked directly to WB-027's wingtips. */
export function createWindTrails(grounds: Grounds): WindTrailsRig {
  const shared = {
    darkU: makeScalarUniform(1),
    timeU: makeScalarUniform(0),
    curlU: makeScalarUniform(0),
  };
  const leftU = makeScalarUniform(0);
  const rightU = makeScalarUniform(0);
  let gain = 0.6;

  // Short tip-only condensation ribbons (~0.24 length) so they never slice across the HUD.
  const configs: readonly RibbonConfig[] = [
    { x: -0.538, y: -0.006, z: 0.004, len: 0.26, hw: 0.004, uInt: leftU, phase: 0.0, weight: 1.0 },
    { x: 0.538, y: -0.006, z: 0.004, len: 0.26, hw: 0.004, uInt: rightU, phase: 3.1, weight: 1.0 },
  ];

  const group = new Group();
  const geos: BufferGeometry[] = [];
  const mats: MeshBasicNodeMaterial[] = [];

  for (const cfg of configs) {
    const geo = buildWindRibbonGeometry(cfg);
    const mat = createRibbonMaterial(cfg, shared, grounds);
    const mesh = new Mesh(geo, mat);
    mesh.renderOrder = 12;
    group.add(mesh);
    geos.push(geo);
    mats.push(mat);
  }

  return {
    group,
    setLook: ({ dark, gain: nextGain }) => {
      shared.darkU.value = dark ? 1 : 0;
      gain = nextGain;
    },
    update: ({ time, bankRoll, bankPitch, speedFactor, reducedMotion }) => {
      shared.timeU.value = time;
      const res = evaluateWindTrailIntensity({
        time,
        bankRoll,
        bankPitch,
        speedFactor,
        gain,
        reducedMotion,
      });
      leftU.value = res.left;
      rightU.value = res.right;
      shared.curlU.value = res.curl;
      group.visible = res.left > 0.01 || res.right > 0.01;
    },
    dispose: () => {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
