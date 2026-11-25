/**
 * Living 3D seagull flock with genuine curved gliding flight across the ocean,
 * altitude-coupled painterly shadows, and 3 distinct bird silhouettes
 * (`gliding-scene.ts`, `ocean-wave.ts`).
 */
import {
  attribute,
  clamp,
  dot,
  float,
  max,
  mix,
  normalView,
  normalWorld,
  positionLocal,
  positionViewDirection,
  pow,
  screenUV,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import {
  BufferGeometry,
  CanvasTexture,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  RGBAFormat,
  type Texture,
} from "three/webgpu";
import type { TslNode } from "@kb/scene-gpu";
import { darkGrade } from "../gpu/dark-grade";
import type { Grounds } from "../gpu/gpu-scene";
import type { ShadowBlendMode } from "./gliding-tuning";
import {
  applyShadowBlending,
  composeShadowBlend,
  painterlyShadowEdge,
  sampleOceanWaveAt,
  shadowBlendIndex,
  type OceanWaveUniforms,
} from "./ocean-wave";

type V3 = TslNode<"vec3">;

const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = (r: number, g: number, b: number): V3 => vec3(lin(r / 255), lin(g / 255), lin(b / 255));

function makeScalarUniform(v: number) {
  return uniform(v);
}

type ScalarUniform = ReturnType<typeof makeScalarUniform>;

export type SeagullVariant = "broad" | "swept" | "slender";
type SeagullGlideStyle = "soar" | "thermal" | "swoop" | "dart";

export interface SeagullSpec {
  /** Hero still/starting coordinates relative to anchor (frame heights). */
  readonly x: number;
  readonly y: number;
  /** Nominal altitude above z = 0 ocean (world units; > 1.38 flies physically above WB-027!). */
  readonly altitude: number;
  /** Altitude breathing amplitude along thermal swells. */
  readonly altAmp: number;
  /** Visual scale relative to frame height. */
  readonly scale: number;
  /** Base heading angle (radians, 0 = +Y north, negative = NE). */
  readonly heading: number;
  /** Forward gliding speed across the viewport (frame heights per second). */
  readonly speed: number;
  /** Lateral thermal curve amplitude (frame heights) & angular rate (rad/s). */
  readonly curveAmp: number;
  readonly curveFreq: number;
  readonly phase: number;
  readonly period: number;
  readonly baseBank: number;
  readonly variant: SeagullVariant;
  /** Distinct avian glide rhythm & wingbeat personality. */
  readonly glideStyle: SeagullGlideStyle;
  readonly stillInner: number;
  readonly stillOuter: number;
}

/**
 * Curated living flock across three altitude layers — low wave-skimmers (0.44–0.60),
 * mid-altitude cruisers (0.76–1.02), and high thermal riders ABOVE WB-027 (1.96–2.20,
 * above AIRCRAFT_Z = 1.38) — each with its own distinct glide style.
 */
export const SEAGULL_SPECS: readonly SeagullSpec[] = [
  {
    x: -0.68,
    y: 0.34,
    altitude: 0.88,
    altAmp: 0.22,
    scale: 0.058,
    heading: -0.52,
    speed: 0.082,
    curveAmp: 0.16,
    curveFreq: 0.24,
    phase: 0.9,
    period: 11.4,
    baseBank: 0.22,
    variant: "broad",
    glideStyle: "soar",
    stillInner: 0.22,
    stillOuter: 0.14,
  },
  {
    x: -0.45,
    y: 0.14,
    altitude: 0.56,
    altAmp: 0.2,
    scale: 0.05,
    heading: -0.94,
    speed: 0.112,
    curveAmp: 0.2,
    curveFreq: 0.34,
    phase: 4.8,
    period: 9.2,
    baseBank: -0.42,
    variant: "slender",
    glideStyle: "dart",
    stillInner: 0.04,
    stillOuter: -0.16,
  },
  {
    x: -0.47,
    y: -0.13,
    altitude: 0.98,
    altAmp: 0.26,
    scale: 0.06,
    heading: -0.74,
    speed: 0.076,
    curveAmp: 0.15,
    curveFreq: 0.22,
    phase: 7.4,
    period: 10.4,
    baseBank: 0.12,
    variant: "swept",
    glideStyle: "swoop",
    stillInner: 0.12,
    stillOuter: -0.06,
  },
  {
    x: -0.82,
    y: -0.36,
    altitude: 0.44,
    altAmp: 0.18,
    scale: 0.052,
    heading: -0.36,
    speed: 0.098,
    curveAmp: 0.18,
    curveFreq: 0.28,
    phase: 2.7,
    period: 8.6,
    baseBank: -0.28,
    variant: "swept",
    glideStyle: "swoop",
    stillInner: 0.28,
    stillOuter: 0.1,
  },
  {
    x: 0.12,
    y: -0.42,
    altitude: 0.54,
    altAmp: 0.18,
    scale: 0.044,
    heading: -0.62,
    speed: 0.122,
    curveAmp: 0.15,
    curveFreq: 0.36,
    phase: 6.2,
    period: 8.8,
    baseBank: 0.2,
    variant: "slender",
    glideStyle: "dart",
    stillInner: 0.09,
    stillOuter: -0.05,
  },
  {
    x: -1.16,
    y: 0.06,
    altitude: 0.74,
    altAmp: 0.2,
    scale: 0.048,
    heading: -0.48,
    speed: 0.086,
    curveAmp: 0.22,
    curveFreq: 0.21,
    phase: 3.1,
    period: 12.2,
    baseBank: -0.18,
    variant: "broad",
    glideStyle: "soar",
    stillInner: 0.11,
    stillOuter: -0.05,
  },
  // High-soaring gulls gliding ABOVE WB-027 (z > 1.38) on wide lazy ocean thermals.
  {
    x: 0.08,
    y: 0.22,
    altitude: 2.02,
    altAmp: 0.24,
    scale: 0.054,
    heading: -0.82,
    speed: 0.072,
    curveAmp: 0.26,
    curveFreq: 0.18,
    phase: 1.6,
    period: 13.8,
    baseBank: 0.28,
    variant: "broad",
    glideStyle: "thermal",
    stillInner: 0.18,
    stillOuter: 0.06,
  },
  {
    x: 0.42,
    y: -0.08,
    altitude: 2.2,
    altAmp: 0.22,
    scale: 0.049,
    heading: -0.38,
    speed: 0.092,
    curveAmp: 0.24,
    curveFreq: 0.23,
    phase: 5.4,
    period: 11.6,
    baseBank: -0.32,
    variant: "swept",
    glideStyle: "thermal",
    stillInner: 0.14,
    stillOuter: -0.08,
  },
];

export interface SeagullFlapPose {
  /** World-relative screen position in frame heights. */
  readonly x: number;
  readonly y: number;
  /** Instantaneous altitude above z = 0 ocean (drives perspective size + shadow offset/scale). */
  readonly altitude: number;
  /** Instantaneous flight heading aligned tangent to the curved velocity vector. */
  readonly heading: number;
  readonly inner: number;
  readonly outer: number;
  readonly bank: number;
}

const wrapRange = (v: number, halfSpan: number): number => {
  const span = halfSpan * 2;
  return ((((v + halfSpan) % span) + span) % span) - halfSpan;
};

interface StyleKinematics {
  readonly flapWindow: number;
  readonly beats: number;
  readonly innerAmp: number;
  readonly outerAmp: number;
  readonly soarDihedral: number;
  readonly bankScale: number;
  readonly surgeAmp: number;
  readonly altFreq: number;
}

const GLIDE_STYLE_PARAMS: Record<SeagullGlideStyle, StyleKinematics> = {
  /** Effortless steady ocean cruiser: long motionless stretched-wing glides, rare gentle 2-beat strokes. */
  soar: {
    flapWindow: 0.18,
    beats: 2,
    innerAmp: 0.24,
    outerAmp: 0.3,
    soarDihedral: 0.09,
    bankScale: 3.8,
    surgeAmp: 0.015,
    altFreq: 0.24,
  },
  /** Wide circling high thermal rider: cupped dihedral wings, graceful sweeping banks & slow climbs. */
  thermal: {
    flapWindow: 0.14,
    beats: 1.5,
    innerAmp: 0.2,
    outerAmp: 0.26,
    soarDihedral: 0.15,
    bankScale: 5.8,
    surgeAmp: 0.01,
    altFreq: 0.18,
  },
  /** Dynamic wave-skimmer: tucks & accelerates into gentle dives, then climbs back with crisp flaps. */
  swoop: {
    flapWindow: 0.3,
    beats: 3,
    innerAmp: 0.31,
    outerAmp: 0.4,
    soarDihedral: 0.03,
    bankScale: 4.8,
    surgeAmp: 0.048,
    altFreq: 0.42,
  },
  /** Nimble crosswind glider: brisk energetic flap-and-dart rhythm with snappy course weaves. */
  dart: {
    flapWindow: 0.36,
    beats: 3.5,
    innerAmp: 0.34,
    outerAmp: 0.42,
    soarDihedral: 0.05,
    bankScale: 5.2,
    surgeAmp: 0.032,
    altFreq: 0.34,
  },
};

/**
 * Pure deterministic living flight kinematics for one seagull:
 * Each gull glides continuously forward with its own `glideStyle` personality (`soar`,
 * `thermal`, `swoop`, or `dart`), turning tangent to its velocity, banking physically into
 * curves, and varying altitude & wingbeat cadence organically.
 */
export function evaluateSeagullPose(
  spec: SeagullSpec,
  time: number,
  reducedMotion: boolean,
  speedScale = 1,
): SeagullFlapPose {
  if (reducedMotion || speedScale <= 0.001) {
    return {
      x: spec.x,
      y: spec.y,
      altitude: spec.altitude,
      heading: spec.heading,
      inner: spec.stillInner,
      outer: spec.stillOuter,
      bank: spec.baseBank,
    };
  }
  const st = GLIDE_STYLE_PARAMS[spec.glideStyle];
  const tFlight = time * Math.max(0.25, speedScale);
  const fwdX = -Math.sin(spec.heading);
  const fwdY = Math.cos(spec.heading);
  const rightX = Math.cos(spec.heading);
  const rightY = Math.sin(spec.heading);

  // Swooping & darting birds accelerate smoothly during downward glides and ease up on climbs.
  const altPhase = tFlight * st.altFreq + spec.phase * 1.3;
  const surge = -Math.cos(altPhase) * st.surgeAmp;
  const dist = tFlight * spec.speed - Math.sin(altPhase) * (st.surgeAmp / st.altFreq);
  const waveA = tFlight * spec.curveFreq + spec.phase;
  const waveB = tFlight * spec.curveFreq * 0.53 + spec.phase * 1.7;
  const lat = Math.sin(waveA) * spec.curveAmp + Math.cos(waveB) * spec.curveAmp * 0.32;
  const latVel =
    Math.cos(waveA) * spec.curveAmp * spec.curveFreq -
    Math.sin(waveB) * spec.curveAmp * 0.32 * spec.curveFreq * 0.53;
  const latAccel =
    -Math.sin(waveA) * spec.curveAmp * spec.curveFreq * spec.curveFreq -
    Math.cos(waveB) * spec.curveAmp * 0.32 * spec.curveFreq * spec.curveFreq * 0.28;

  const fwdSpeed = Math.max(0.03, spec.speed + surge);
  const vx = fwdX * fwdSpeed + rightX * latVel;
  const vy = fwdY * fwdSpeed + rightY * latVel;
  const liveHeading = Math.atan2(-vx, vy);

  const x = wrapRange(spec.x + fwdX * dist + rightX * lat, 1.48);
  const y = wrapRange(spec.y + fwdY * dist + rightY * lat, 0.88);
  const altitude = Math.max(0.26, spec.altitude + Math.sin(altPhase) * spec.altAmp);

  const period = Math.max(4, spec.period);
  const u = (((tFlight + spec.phase) % period) + period) % period;
  const norm = u / period;
  const diveTuck = spec.glideStyle === "swoop" ? Math.max(0, -Math.cos(altPhase)) * 0.08 : 0;
  const soarBase = st.soarDihedral - diveTuck + Math.sin(tFlight * 0.55 + spec.phase) * 0.026;
  const soarTip = -0.035 - diveTuck * 0.6 + Math.cos(tFlight * 0.48 + spec.phase * 1.3) * 0.022;

  let flapInner = 0;
  let flapOuter = 0;
  if (norm < st.flapWindow) {
    const f = norm / st.flapWindow;
    const env = 0.5 - 0.5 * Math.cos(f * Math.PI * 2);
    const beatPhase = f * Math.PI * 2 * st.beats;
    flapInner = Math.sin(beatPhase) * st.innerAmp * env;
    flapOuter = Math.sin(beatPhase - 0.85) * st.outerAmp * env;
  }

  const turnBank = Math.max(-0.58, Math.min(0.58, latAccel * st.bankScale));
  const bank = spec.baseBank * 0.45 + turnBank;

  return {
    x,
    y,
    altitude,
    heading: liveHeading,
    inner: soarBase + flapInner,
    outer: soarTip + flapOuter,
    bank,
  };
}

interface BirdVert {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly span: number;
}

interface MeshAccumulator {
  readonly positions: number[];
  readonly colors: number[];
  readonly wingSpans: number[];
}

function pushVert(acc: MeshAccumulator, v: BirdVert): void {
  acc.positions.push(v.x, v.y, v.z);
  acc.colors.push(lin(v.r / 255), lin(v.g / 255), lin(v.b / 255));
  acc.wingSpans.push(v.span);
}

function pushTri(acc: MeshAccumulator, a: BirdVert, b: BirdVert, c: BirdVert): void {
  pushVert(acc, a);
  pushVert(acc, b);
  pushVert(acc, c);
}

function pushQuad(acc: MeshAccumulator, a: BirdVert, b: BirdVert, c: BirdVert, d: BirdVert): void {
  pushTri(acc, a, b, c);
  pushTri(acc, a, c, d);
}

interface VariantShape {
  readonly spanMult: number;
  readonly chordMult: number;
  readonly sweepBack: number;
  readonly mantleTint: readonly [number, number, number];
  readonly tipStart: number;
}

const VARIANT_SHAPES: Record<SeagullVariant, VariantShape> = {
  broad: {
    spanMult: 1.04,
    chordMult: 1.14,
    sweepBack: 0.0,
    mantleTint: [238, 240, 238],
    tipStart: 0.64,
  },
  swept: {
    spanMult: 1.0,
    chordMult: 0.94,
    sweepBack: 0.09,
    mantleTint: [216, 224, 232],
    tipStart: 0.58,
  },
  slender: {
    spanMult: 0.92,
    chordMult: 0.78,
    sweepBack: 0.16,
    mantleTint: [204, 214, 224],
    tipStart: 0.54,
  },
};

function appendSeagullBody(acc: MeshAccumulator, shape: VariantShape): void {
  const m = shape.mantleTint;
  const bodyStations: readonly {
    readonly y: number;
    readonly rx: number;
    readonly rz: number;
    readonly zc: number;
    readonly col: readonly [number, number, number];
  }[] = [
    { y: 0.48, rx: 0.004, rz: 0.004, zc: 0.005, col: [224, 168, 62] },
    { y: 0.37, rx: 0.022, rz: 0.02, zc: 0.012, col: [232, 186, 86] },
    { y: 0.3, rx: 0.054, rz: 0.046, zc: 0.018, col: [248, 246, 240] },
    { y: 0.2, rx: 0.044, rz: 0.04, zc: 0.014, col: [244, 242, 236] },
    { y: 0.04, rx: 0.078, rz: 0.06, zc: 0.008, col: m },
    { y: -0.14, rx: 0.064, rz: 0.048, zc: 0.004, col: m },
    { y: -0.3, rx: 0.034, rz: 0.02, zc: 0.006, col: [240, 240, 236] },
    { y: -0.49, rx: 0.11 * shape.chordMult, rz: 0.008, zc: 0.01, col: [246, 245, 240] },
  ];

  const ringSegs = 6;
  const ringPt = (st: (typeof bodyStations)[number], seg: number): BirdVert => {
    const a = (seg / ringSegs) * Math.PI * 2;
    const shade = Math.sin(a) > 0 ? 1 : 0.92;
    return {
      x: Math.cos(a) * st.rx,
      y: st.y,
      z: st.zc + Math.sin(a) * st.rz,
      r: st.col[0] * shade,
      g: st.col[1] * shade,
      b: st.col[2] * shade,
      span: 0,
    };
  };

  for (let i = 0; i < bodyStations.length - 1; i++) {
    const sa = bodyStations[i];
    const sb = bodyStations[i + 1];
    if (!sa || !sb) continue;
    for (let k = 0; k < ringSegs; k++) {
      const k1 = (k + 1) % ringSegs;
      pushQuad(acc, ringPt(sa, k), ringPt(sb, k), ringPt(sb, k1), ringPt(sa, k1));
    }
  }
  const tailSt = bodyStations[bodyStations.length - 1];
  if (!tailSt) return;
  const tailCenter: BirdVert = {
    x: 0,
    y: tailSt.y - 0.015,
    z: tailSt.zc,
    r: 246,
    g: 245,
    b: 240,
    span: 0,
  };
  for (let k = 0; k < ringSegs; k++) {
    const k1 = (k + 1) % ringSegs;
    pushTri(acc, ringPt(tailSt, k), tailCenter, ringPt(tailSt, k1));
  }
}

function appendSeagullWings(acc: MeshAccumulator, shape: VariantShape): void {
  const m = shape.mantleTint;
  const baseStations = [
    { span: 0.06, yLead: 0.14, yTrail: -0.15, zBase: 0.022, thick: 0.024 },
    { span: 0.24, yLead: 0.2, yTrail: -0.1, zBase: 0.04, thick: 0.02 },
    { span: 0.44, yLead: 0.22, yTrail: -0.03, zBase: 0.056, thick: 0.015 },
    { span: 0.62, yLead: 0.13, yTrail: -0.07, zBase: 0.044, thick: 0.011 },
    { span: 0.78, yLead: 0.01, yTrail: -0.15, zBase: 0.026, thick: 0.008 },
    { span: 0.92, yLead: -0.12, yTrail: -0.22, zBase: 0.012, thick: 0.005 },
    { span: 1.0, yLead: -0.23, yTrail: -0.255, zBase: 0.006, thick: 0.003 },
  ] as const;

  const wingVert = (
    st: (typeof baseStations)[number],
    side: -1 | 1,
    slot: "lead" | "mid" | "trail",
  ): BirdVert => {
    const s = st.span;
    const x = side * s * shape.spanMult;
    const sweep = s * s * shape.sweepBack;
    const yLead = st.yLead * shape.chordMult - sweep;
    const yTrail = st.yTrail * shape.chordMult - sweep;
    const y = slot === "lead" ? yLead : slot === "trail" ? yTrail : yLead * 0.62 + yTrail * 0.38;
    const z =
      slot === "lead"
        ? st.zBase
        : slot === "mid"
          ? st.zBase + st.thick
          : st.zBase - st.thick * 0.25;
    const tipBlend = Math.min(1, Math.max(0, (s - shape.tipStart) / 0.18));
    const darkFactor =
      slot === "trail" ? Math.min(1, tipBlend + 0.15 * Math.max(0, s - 0.5)) : tipBlend;
    const baseR = slot === "lead" ? 242 : m[0];
    const baseG = slot === "lead" ? 242 : m[1];
    const baseB = slot === "lead" ? 238 : m[2];
    return {
      x,
      y,
      z,
      r: baseR + (24 - baseR) * darkFactor,
      g: baseG + (28 - baseG) * darkFactor,
      b: baseB + (36 - baseB) * darkFactor,
      span: s,
    };
  };

  for (const side of [-1, 1] as const) {
    for (let i = 0; i < baseStations.length - 1; i++) {
      const a = baseStations[i];
      const b = baseStations[i + 1];
      if (!a || !b) continue;
      const aL = wingVert(a, side, "lead");
      const aM = wingVert(a, side, "mid");
      const aT = wingVert(a, side, "trail");
      const bL = wingVert(b, side, "lead");
      const bM = wingVert(b, side, "mid");
      const bT = wingVert(b, side, "trail");
      if (side > 0) {
        pushQuad(acc, aL, aM, bM, bL);
        pushQuad(acc, aM, aT, bT, bM);
      } else {
        pushQuad(acc, aL, bL, bM, aM);
        pushQuad(acc, aM, bM, bT, aT);
      }
    }
  }
}

export function buildSeagullGeometry(variant: SeagullVariant = "broad"): BufferGeometry {
  const acc: MeshAccumulator = { positions: [], colors: [], wingSpans: [] };
  const shape = VARIANT_SHAPES[variant];
  appendSeagullBody(acc, shape);
  appendSeagullWings(acc, shape);
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(acc.positions, 3));
  geo.setAttribute("color", new Float32BufferAttribute(acc.colors, 3));
  geo.setAttribute("aWingSpan", new Float32BufferAttribute(acc.wingSpans, 1));
  geo.computeVertexNormals();
  return geo;
}

function createSoftBirdShadowTexture(blurPx: number): Texture {
  if (typeof document !== "undefined") {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.translate(size * 0.5, size * 0.5);
      ctx.filter = `blur(${blurPx}px)`;
      ctx.fillStyle = "rgba(255, 255, 255, 1)";
      ctx.beginPath();
      ctx.moveTo(0, -24);
      ctx.quadraticCurveTo(6, -12, 16, -12);
      ctx.quadraticCurveTo(34, -14, 48, 12);
      ctx.quadraticCurveTo(26, 2, 7, 6);
      ctx.lineTo(5, 26);
      ctx.lineTo(-5, 26);
      ctx.lineTo(-7, 6);
      ctx.quadraticCurveTo(-26, 2, -48, 12);
      ctx.quadraticCurveTo(-34, -14, -16, -12);
      ctx.quadraticCurveTo(-6, -12, 0, -24);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      const tex = new CanvasTexture(canvas);
      tex.minFilter = LinearFilter;
      tex.magFilter = LinearFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      return tex;
    }
  }
  const fallback = new DataTexture(new Uint8Array([255, 255, 255, 0]), 1, 1, RGBAFormat);
  fallback.needsUpdate = true;
  return fallback;
}

function createBirdMaterial(
  innerU: ScalarUniform,
  outerU: ScalarUniform,
  shared: { readonly dark: ScalarUniform; readonly sunWarmth: ScalarUniform },
  grounds: Grounds,
): MeshBasicNodeMaterial {
  const span = attribute("aWingSpan", "float");
  const vCol = attribute("color", "vec3");
  const bendZ = span.mul(innerU).add(span.mul(span).mul(outerU));
  const foreshorten = float(1).sub(bendZ.mul(bendZ).mul(0.28));

  const mat = new MeshBasicNodeMaterial({ side: DoubleSide });
  mat.positionNode = vec3(
    positionLocal.x.mul(foreshorten),
    positionLocal.y,
    positionLocal.z.add(bendZ),
  );

  const sunDir = vec3(0.76, 0.36, 0.54).normalize();
  const n = normalWorld.normalize();
  const ndl = dot(n, sunDir);
  const shade = float(0.56)
    .add(smoothstep(-0.1, 0.35, ndl).mul(0.36))
    .add(smoothstep(0.55, 0.85, ndl).mul(0.14));
  const warmKey = vec3(1.04, 1.01, 0.94).add(vec3(0.06, 0.02, -0.07).mul(shared.sunWarmth));
  const rim = pow(
    clamp(float(1).sub(max(dot(normalView.normalize(), positionViewDirection), 0)), 0, 1),
    2.8,
  );
  const seaBounce = mix(rgb(22, 176, 192), rgb(110, 198, 214), float(1).sub(shared.dark)).mul(
    clamp(float(1).sub(max(n.z, 0)), 0, 1).mul(0.24),
  );
  const lit = vCol
    .mul(shade)
    .mul(warmKey)
    .add(seaBounce)
    .add(warmKey.mul(rim.mul(0.16)));
  const darkOut = darkGrade(clamp(lit, vec3(0, 0, 0), vec3(0.992, 0.992, 0.992)), grounds.page);
  const lightOut = clamp(
    mix(lit.mul(1.03), vec3(0.97, 0.97, 0.95), 0.04),
    vec3(0, 0, 0),
    vec3(0.992, 0.992, 0.992),
  );
  mat.colorNode = grounds.paint(mix(lightOut, darkOut, shared.dark));
  return mat;
}

interface FlockSharedUniforms {
  readonly dark: ScalarUniform;
  readonly sunWarmth: ScalarUniform;
  readonly aspect: ScalarUniform;
  readonly shadowBlend: ScalarUniform;
  readonly shadowDepth: ScalarUniform;
  readonly shadowSoftness: ScalarUniform;
}

/** Painterly brush-broken bird shadow warped by live ocean swells with switchable blend modes. */
function createWaveBirdShadowMaterial(
  shadowTex: Texture,
  altU: ScalarUniform,
  shared: FlockSharedUniforms,
  wave: OceanWaveUniforms,
  grounds: Grounds,
): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial({
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
  });
  applyShadowBlending(mat, "multiply");
  const at = vec2(screenUV.x, float(1).sub(screenUV.y));
  const frameP = vec2(at.x.sub(0.5).mul(shared.aspect), at.y.sub(0.5));
  const w = sampleOceanWaveAt(wave, frameP);

  // Altitude & softness scale wave refraction + painterly brush-broken perimeter (no smooth Gaussian fog).
  const warpAmp = float(0.032).add(altU.mul(0.024)).mul(shared.shadowSoftness.mul(0.45).add(0.55));
  const warpedUv = uv().add(vec2(w.slopeX.mul(warpAmp), w.slopeY.mul(warpAmp)));
  const raw = texture(shadowTex, warpedUv).a;
  const edged = painterlyShadowEdge(raw, frameP, w, shared.shadowSoftness.add(altU.mul(0.25)));

  const waveMod = mix(float(1.16), float(0.72), w.height);
  const troughCol = mix(rgb(20, 92, 122), rgb(2, 20, 44), shared.dark);
  const crestCol = mix(rgb(56, 140, 164), rgb(8, 54, 82), shared.dark);
  const altFade = clamp(float(0.56).sub(altU.mul(0.18)), 0.18, 0.54);
  const alpha = clamp(
    edged.mask
      .mul(waveMod)
      .mul(altFade)
      .mul(shared.shadowDepth)
      .mul(mix(float(0.78), float(1.0), shared.dark)),
    0,
    0.78,
  );
  const blended = composeShadowBlend({
    mode: shared.shadowBlend,
    dark: shared.dark,
    waveHeight: w.height,
    opacity: alpha,
    wetRim: edged.wetRim,
    normalColor: grounds.paint(mix(troughCol, crestCol, w.height.mul(0.55))),
  });
  mat.colorNode = blended.color;
  mat.opacityNode = blended.opacity;
  return mat;
}

export interface SeagullFlockRig {
  readonly birds: Group;
  readonly shadows: Group;
  readonly setLook: (opts: {
    readonly dark: boolean;
    readonly sunWarmth: number;
    readonly parallax: number;
    readonly shadowBlend: ShadowBlendMode;
    readonly shadowDepth: number;
    readonly shadowSoftness: number;
    readonly shadowSize: number;
    readonly shadowAltitude: number;
    readonly birdsAmount: number;
  }) => void;
  readonly setLayout: (opts: {
    readonly anchorX: number;
    readonly anchorY: number;
    readonly scale: number;
    readonly aspect: number;
    readonly fovDeg: number;
    readonly cameraZ: number;
  }) => void;
  readonly update: (opts: {
    readonly time: number;
    readonly dollyX: number;
    readonly dollyY: number;
    readonly reducedMotion: boolean;
  }) => void;
  readonly dispose: () => void;
}

interface BirdInstance {
  readonly spec: SeagullSpec;
  readonly mesh: Mesh;
  readonly shadowMesh: Mesh;
  readonly innerU: ScalarUniform;
  readonly outerU: ScalarUniform;
  readonly altU: ScalarUniform;
}

interface FlockLayout {
  readonly anchorX: number;
  readonly anchorY: number;
  readonly scale: number;
  readonly cameraZ: number;
  readonly tanHalf: number;
}

function positionBirdInstance(
  item: BirdInstance,
  layout: FlockLayout,
  ctx: {
    readonly time: number;
    readonly dollyX: number;
    readonly dollyY: number;
    readonly parallax: number;
    readonly altScale: number;
    readonly shadowSize: number;
    readonly birdsAmount: number;
    readonly reducedMotion: boolean;
  },
): void {
  const { spec, mesh, shadowMesh, innerU, outerU, altU } = item;
  const pose = evaluateSeagullPose(spec, ctx.time, ctx.reducedMotion, ctx.birdsAmount);
  const alt = pose.altitude * ctx.altScale;
  innerU.value = pose.inner;
  outerU.value = pose.outer;
  altU.value = alt;

  const waterWorldPerHeight = 2 * layout.cameraZ * layout.tanHalf;
  const waterParallax = 1 + 0.08 * ctx.parallax;
  const birdWorldPerHeight = 2 * Math.max(3, layout.cameraZ - alt) * layout.tanHalf;
  const birdParallax = 1 + (0.14 + alt * 0.34) * ctx.parallax;

  const bx =
    (layout.anchorX + pose.x * layout.scale - ctx.dollyX * birdParallax) * birdWorldPerHeight;
  const by =
    (layout.anchorY + pose.y * layout.scale - ctx.dollyY * birdParallax) * birdWorldPerHeight;
  mesh.position.set(bx, by, alt);
  mesh.scale.setScalar(spec.scale * layout.scale * birdWorldPerHeight);
  mesh.rotation.set(0, pose.bank, pose.heading);

  const sx =
    (layout.anchorX +
      pose.x * layout.scale -
      0.22 * alt * layout.scale -
      ctx.dollyX * waterParallax) *
    waterWorldPerHeight;
  const sy =
    (layout.anchorY +
      pose.y * layout.scale -
      0.1 * alt * layout.scale -
      ctx.dollyY * waterParallax) *
    waterWorldPerHeight;
  // Lower altitude -> tighter/crisper shadow; higher altitude -> slightly wider, softer penumbra.
  const penumbra =
    ctx.shadowSize *
    (1.04 + alt * 0.28 - Math.abs(pose.inner) * 0.22) *
    spec.scale *
    layout.scale *
    waterWorldPerHeight;
  shadowMesh.position.set(sx, sy, 0.01);
  shadowMesh.scale.set(penumbra * Math.max(0.55, Math.cos(pose.bank * 0.7)), penumbra, 1);
  shadowMesh.rotation.set(0, 0, pose.heading);
}

const INITIAL_FLOCK_LAYOUT: FlockLayout = {
  anchorX: 0.25,
  anchorY: 0,
  scale: 1,
  cameraZ: 10,
  tanHalf: Math.tan((20 * Math.PI) / 180),
};

/** Build the living WebGPU/TSL seagull flock and soft painterly wave-interactive shadows. */
export function createSeagullFlock(grounds: Grounds, wave: OceanWaveUniforms): SeagullFlockRig {
  const variantGeos: Record<SeagullVariant, BufferGeometry> = {
    broad: buildSeagullGeometry("broad"),
    swept: buildSeagullGeometry("swept"),
    slender: buildSeagullGeometry("slender"),
  };
  const shadowGeo = new PlaneGeometry(2.3, 2.3);
  const lowShadowTex = createSoftBirdShadowTexture(6.5);
  const highShadowTex = createSoftBirdShadowTexture(11.5);
  const shared: FlockSharedUniforms = {
    dark: makeScalarUniform(1),
    sunWarmth: makeScalarUniform(0),
    aspect: makeScalarUniform(1.7),
    shadowBlend: makeScalarUniform(1),
    shadowDepth: makeScalarUniform(1),
    shadowSoftness: makeScalarUniform(1),
  };

  const birds = new Group();
  const shadows = new Group();
  const mats: MeshBasicNodeMaterial[] = [];
  const shadowMats: MeshBasicNodeMaterial[] = [];

  const instances: BirdInstance[] = SEAGULL_SPECS.map((spec) => {
    const innerU = makeScalarUniform(spec.stillInner);
    const outerU = makeScalarUniform(spec.stillOuter);
    const altU = makeScalarUniform(spec.altitude);
    const birdMat = createBirdMaterial(innerU, outerU, shared, grounds);
    const sTex = spec.altitude > 0.68 ? highShadowTex : lowShadowTex;
    const shadowMat = createWaveBirdShadowMaterial(sTex, altU, shared, wave, grounds);
    mats.push(birdMat, shadowMat);
    shadowMats.push(shadowMat);
    const mesh = new Mesh(variantGeos[spec.variant], birdMat);
    const shadowMesh = new Mesh(shadowGeo, shadowMat);
    birds.add(mesh);
    shadows.add(shadowMesh);
    return { spec, mesh, shadowMesh, innerU, outerU, altU };
  });

  let parallax = 1;
  let altScale = 1;
  let shadowSize = 1;
  let birdsAmount = 1;
  let lastTime = 0;
  let layout = INITIAL_FLOCK_LAYOUT;

  const applyFrame = (time: number, dollyX: number, dollyY: number, reducedMotion: boolean) => {
    lastTime = time;
    const visible = birdsAmount > 0.02;
    birds.visible = visible;
    shadows.visible = visible;
    if (!visible) return;
    const ctx = {
      time,
      dollyX,
      dollyY,
      parallax,
      altScale,
      shadowSize,
      birdsAmount,
      reducedMotion,
    };
    for (const item of instances) positionBirdInstance(item, layout, ctx);
  };

  applyFrame(0, 0, 0, true);

  return {
    birds,
    shadows,
    setLook: ({
      dark,
      sunWarmth,
      parallax: nextParallax,
      shadowBlend,
      shadowDepth,
      shadowSoftness,
      shadowSize: nextSize,
      shadowAltitude,
      birdsAmount: nextBirds,
    }) => {
      shared.dark.value = dark ? 1 : 0;
      shared.sunWarmth.value = sunWarmth;
      shared.shadowBlend.value = shadowBlendIndex(shadowBlend);
      shared.shadowDepth.value = shadowDepth;
      shared.shadowSoftness.value = shadowSoftness;
      for (const sm of shadowMats) applyShadowBlending(sm, shadowBlend);
      parallax = nextParallax;
      altScale = shadowAltitude;
      shadowSize = nextSize;
      birdsAmount = nextBirds;
    },
    setLayout: ({ anchorX, anchorY, scale, aspect, fovDeg, cameraZ }) => {
      shared.aspect.value = aspect;
      layout = {
        anchorX,
        anchorY,
        scale,
        cameraZ,
        tanHalf: Math.tan(((fovDeg * Math.PI) / 180) * 0.5),
      };
      applyFrame(lastTime, 0, 0, false);
    },
    update: ({ time, dollyX, dollyY, reducedMotion }) => {
      applyFrame(time, dollyX, dollyY, reducedMotion);
    },
    dispose: () => {
      variantGeos.broad.dispose();
      variantGeos.swept.dispose();
      variantGeos.slender.dispose();
      shadowGeo.dispose();
      lowShadowTex.dispose();
      highShadowTex.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
