/**
 * Prism ribbon shader (T1): a single-pass raymarched 3D twisted iridescent
 * membrane floating above a dissolving midnight-navy & warm-plum field,
 * inscribed with curvature-projected blueprint wireframes and crisp SDF
 * monospace shader code.
 *
 * Surface reveal & pacing:
 * - Mirrors the original artwork's progressive 3-stage surface wave:
 *   pure iridescent glass → crisp blueprint wireframe (`mWire * (1 - mCode)`)
 *   → rock-solid monospace shader code (`mCode`), with subtle decode scramble
 *   confined strictly to the narrow leading materialization fringe and
 *   high-frequency surface-space stipple dissolve (zero screen-space swimming).
 * - Raymarch hits take a final Newton surface projection step (`hitT + minD`)
 *   before computing surface UVs and derivatives, eliminating step-boundary
 *   text shimmer as the ribbon moves.
 * - Out-of-frame / lower-boundary transition: wherever an animated belly dip
 *   reaches past the active field toward the bottom of the page head, the
 *   ribbon first sheds prism & code into the original's sleek matte studio
 *   silhouette, then merges cleanly into the page ground so no hard horizontal
 *   cut-off line ever appears.
 *
 * Passes per frame:
 * 1. Scene backgroundNode (this shader).
 * 2. Stage bloom (dark mode only, catching only HDR cream-gold crests).
 * 3. Stage composite (shoulder tone curve, edge feather, IGN dither, film grain).
 */
import {
  Break,
  Fn,
  If,
  Loop,
  abs,
  clamp,
  cos,
  dot,
  exp,
  float,
  floor,
  fract,
  fwidth,
  int,
  inversesqrt,
  length,
  max,
  min,
  mix,
  mod,
  normalize,
  pow,
  reflect,
  screenCoordinate,
  screenSize,
  screenUV,
  select,
  sin,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import { Matrix3, Vector2, Vector3, type DataTexture } from "three/webgpu";
import type { TslNode } from "@kb/scene-gpu";
import { dissolve, dissolveUniforms } from "../gpu/dissolve";
import type { Grounds } from "../gpu/gpu-scene";
import { gnoise, hash, hash2 } from "../gpu/noise";
import type { textScrim } from "../gpu/text-scrim";
import { CODE_BUFFER_LEN } from "./prism-ribbon";
import { ATLAS_COLS, ATLAS_ROWS } from "./sdf-font";

type F = TslNode<"float">;
type V2 = TslNode<"vec2">;
type V3 = TslNode<"vec3">;

const PI = Math.PI;
const RIBBON_BASE_WIDTH = 0.248;
const RIBBON_FREQ_X = 1.72;
const RIBBON_AMP = 0.31;
const RIBBON_TWIST_K = 0.936;
const RIBBON_BULGE_K = 0.364;
const FOCAL = 1.8;
const CAMERA_Z = -3.4;
const HIT_EPS = 0.0014;
const HALO_R = 0.32;

export function prismRibbonUniforms() {
  return {
    /** Ribbon undulation/flow clock (`time * 0.749` pacing ratio). */
    flow: uniform(4.65),
    /** Mask reveal, edge decode & background wash clock (`0.57/s` at 1× speed). */
    time: uniform(1.15),
    /** 1 for dark page, 0 for light page. */
    dark: uniform(1),
    /** Hero anchor in frame units: (x, y, scale). */
    hero: uniform(new Vector3(0, 0, 1)),
    /** Bounded eased pointer lean in frame units: (x, y, near). */
    pointer: uniform(new Vector3(0, 0, 0)),
    /** Smoothly damped cursor position in frame units for hover code reveal & field glow. */
    cursor: uniform(new Vector2(0, 0)),
    /** Adaptive max raymarch steps (20 at full quality, 12 at floor). */
    steps: uniform(20, "int"),
    /** Model rotation & its transpose (updated on CPU from base tilt + pointer + seed). */
    modelRot: uniform(new Matrix3()),
    invModelRot: uniform(new Matrix3()),
    /** Hue turn matrix (seed + hue knob). */
    turn: uniform(new Matrix3()),
    /** Projected code & grid overlay intensity multiplier. */
    codeGain: uniform(1),
    /** Prismatic dispersion width multiplier. */
    prismGain: uniform(1),
    /** Traveling optical write wave: `(spineX, energy)`. */
    writeWave: uniform(new Vector2(-1.95, 0)),
    /** Typing calm signal (`0..1`): settles glare and quietens code while editing. */
    calm: uniform(0),
    /** Seeded background field phase offset. */
    fieldPhase: uniform(0),
    /** Encoded code line length in characters. */
    codeLen: uniform(128),
    /** Ground field dissolve reach (ground only — never clips the active ribbon). */
    reach: dissolveUniforms(),
  };
}
export type PrismRibbonUniforms = ReturnType<typeof prismRibbonUniforms>;

/** 2D rotation matching GLSL column-major `mat2(c, -s, s, c) * v`. */
const rot2 = (v: V2, a: F): V2 => {
  const c = cos(a);
  const s = sin(a);
  return vec2(c.mul(v.x).add(s.mul(v.y)), s.negate().mul(v.x).add(c.mul(v.y)));
};

const toLinear = (c: V3): V3 => pow(max(c, vec3(0, 0, 0)), vec3(2.2, 2.2, 2.2));

const ribbonHalfWidthFn = Fn(([x, t]: readonly [F, F]) => {
  return float(RIBBON_BASE_WIDTH).mul(
    float(1)
      .add(sin(x.mul(1.13).add(2.0).sub(t.mul(0.17))).mul(0.3))
      .add(sin(x.mul(2.71).add(t.mul(0.31))).mul(0.12)),
  );
}).setLayout({
  name: "kbPrismHalfW",
  type: "float",
  inputs: [
    { name: "x", type: "float" },
    { name: "t", type: "float" },
  ],
});

const ribbonPathFn = Fn(([x, t]: readonly [F, F]) => {
  const xf = x.mul(RIBBON_FREQ_X);
  const y = sin(xf.mul(0.9).add(t.mul(0.6)))
    .mul(0.55)
    .add(sin(xf.mul(1.73).sub(t.mul(0.37)).add(1.3)).mul(0.3))
    .add(sin(xf.mul(3.1).add(t.mul(0.23)).add(4.0)).mul(0.07));
  const z = cos(xf.mul(0.71).sub(t.mul(0.43)).add(0.6))
    .mul(0.65)
    .add(sin(xf.mul(1.37).add(t.mul(0.29)).add(2.1)).mul(0.3));
  return vec2(y, z).mul(RIBBON_AMP);
}).setLayout({
  name: "kbPrismPath",
  type: "vec2",
  inputs: [
    { name: "x", type: "float" },
    { name: "t", type: "float" },
  ],
});

const ribbonTwistFn = Fn(([x, t]: readonly [F, F]) => {
  return float(RIBBON_TWIST_K)
    .mul(
      x
        .mul(0.8)
        .add(sin(x.mul(0.83).sub(t.mul(0.31)).add(0.7)).mul(0.9))
        .add(sin(x.mul(2.05).add(t.mul(0.23))).mul(0.22)),
    )
    .add(t.mul(0.12));
}).setLayout({
  name: "kbPrismTwist",
  type: "float",
  inputs: [
    { name: "x", type: "float" },
    { name: "t", type: "float" },
  ],
});

const sdRoundRectFn = Fn(([q, b, r]: readonly [V2, V2, F]) => {
  const d = abs(q).sub(b).add(r);
  return length(max(d, vec2(0, 0)))
    .add(min(max(d.x, d.y), float(0)))
    .sub(r);
}).setLayout({
  name: "kbPrismRoundRect",
  type: "float",
  inputs: [
    { name: "q", type: "vec2" },
    { name: "b", type: "vec2" },
    { name: "r", type: "float" },
  ],
});

/** Signed distance + `(surfU, surfV)` ribbon curvature coordinates. */
const mapRibbonFn = Fn(([p, t]: readonly [V3, F]) => {
  const path = ribbonPathFn(p.x, t);
  const twist = ribbonTwistFn(p.x, t);
  const q0 = rot2(vec2(p.y.sub(path.x), p.z.sub(path.y)), twist).toVar();
  const w = ribbonHalfWidthFn(p.x, t).toVar();
  const curl = sin(p.x.mul(0.57).add(1.0).add(t.mul(0.13))).mul(0.9);
  const qy = q0.y.sub(curl.mul(q0.x).mul(q0.x));
  const q = vec2(q0.x, qy);
  const th = float(0.012).add(w.mul(0.05));
  const surfY = q0.x.div(w);
  const swell = float(0.55).add(
    float(0.45).mul(
      sin(p.x.mul(4.3).add(0.6).sub(t.mul(0.37)))
        .mul(0.5)
        .add(sin(p.x.mul(7.1).add(2.2).add(t.mul(0.23))).mul(0.3))
        .add(sin(p.x.mul(11.9).sub(1.3).sub(t.mul(0.51))).mul(0.2)),
    ),
  );
  const bulge = w.mul(RIBBON_BULGE_K).mul(swell);
  const u = clamp(surfY, float(-1), float(1));
  const slope = abs(curl.mul(q0.x).mul(2)).add(abs(bulge.mul(u).mul(2).div(w)));
  const dist = sdRoundRectFn(q, vec2(w, th), th.mul(0.9))
    .sub(bulge.mul(float(1).sub(u.mul(u))))
    .mul(inversesqrt(float(1).add(slope.mul(slope))));
  return vec3(dist, p.x, surfY);
}).setLayout({
  name: "kbPrismMapRibbon",
  type: "vec3",
  inputs: [
    { name: "p", type: "vec3" },
    { name: "t", type: "float" },
  ],
});

/** Tetrahedral SDF normal gradient in object space. */
const ribbonNormalFn = Fn(([p, t]: readonly [V3, F]) => {
  const e = float(0.0012);
  const k1 = vec3(1, -1, -1);
  const k2 = vec3(-1, -1, 1);
  const k3 = vec3(-1, 1, -1);
  const k4 = vec3(1, 1, 1);
  return normalize(
    k1
      .mul(mapRibbonFn(p.add(k1.mul(e)), t).x)
      .add(k2.mul(mapRibbonFn(p.add(k2.mul(e)), t).x))
      .add(k3.mul(mapRibbonFn(p.add(k3.mul(e)), t).x))
      .add(k4.mul(mapRibbonFn(p.add(k4.mul(e)), t).x)),
  );
}).setLayout({
  name: "kbPrismNormal",
  type: "vec3",
  inputs: [
    { name: "p", type: "vec3" },
    { name: "t", type: "float" },
  ],
});

/**
 * Progressive surface reveal mask matching the original artwork's paced
 * wave (`drift = time * 0.563`, `pFreq = 1.25`, `nScale = 1.501`):
 * `< 0` pure glass, `0..1` border shift, `1..2` wireframe grid, `> 2` code.
 */
const maskStageFn = Fn(
  ([surf, pFrame, cursor, near, time, pulseLift]: readonly [V2, V2, V2, F, F, F]) => {
    const drift = time.mul(0.563);
    const xCoord = surf.x.mul(1.25).sub(drift);
    const pNoise = vec2(xCoord.mul(0.9), surf.y.mul(2.1));
    // `gnoise` is centered at 0.5 with ~0.25 amplitude; ×3.8 matches 2D simplex [-1, 1] variance.
    const n1 = gnoise(pNoise).sub(0.5).mul(3.8);
    const n2 = gnoise(pNoise.mul(2.25).add(vec2(drift.mul(-0.2), 1.4)))
      .sub(0.5)
      .mul(3.8);
    const noiseVal = clamp(n1.mul(0.68).add(n2.mul(0.32)), float(-1), float(1));
    const wave = sin(xCoord.mul(PI * 0.5));
    const combined = wave.mul(0.65).add(noiseVal.mul(0.75));
    const toCursor = pFrame.sub(cursor);
    const cursorLift = exp(dot(toCursor, toCursor).mul(-12.0)).mul(1.15).mul(near);
    const raw = combined.add(0.16).add(cursorLift).add(pulseLift);
    return select(raw.greaterThan(0), raw.mul(2.6), float(-1));
  },
).setLayout({
  name: "kbPrismMaskStage",
  type: "float",
  inputs: [
    { name: "surf", type: "vec2" },
    { name: "pFrame", type: "vec2" },
    { name: "cursor", type: "vec2" },
    { name: "near", type: "float" },
    { name: "time", type: "float" },
    { name: "pulseLift", type: "float" },
  ],
});

/** Deep midnight navy-blue blended with warm dark plum/burgundy corner washes. */
const fieldColorDarkFn = Fn(([q, t]: readonly [V2, F]) => {
  const w1 = sin(q.x.mul(1.85).add(q.y.mul(1.65)).add(t.mul(0.24)).add(0.65))
    .mul(0.5)
    .add(0.5);
  const w2raw = sin(q.y.mul(2.45).sub(q.x.mul(1.45)).sub(t.mul(0.18)).add(1.3))
    .mul(0.5)
    .add(0.5);
  const w2 = w2raw.mul(w2raw);
  const deepNavy = vec3(0.09, 0.155, 0.325);
  const royalNavy = vec3(0.15, 0.255, 0.485);
  const warmPlum = vec3(0.38, 0.225, 0.265);
  const diagPlum = smoothstep(float(0.04), float(0.92), q.x.mul(q.y).negate().mul(1.15).add(0.32));
  const base = mix(deepNavy, royalNavy, w1);
  return mix(base, warmPlum, clamp(w2.mul(0.42).add(diagPlum.mul(0.44)), float(0), float(0.7)));
}).setLayout({
  name: "kbPrismFieldDark",
  type: "vec3",
  inputs: [
    { name: "q", type: "vec2" },
    { name: "t", type: "float" },
  ],
});

/**
 * Sleek dark studio-chrome reflection for the ribbon where it dips past the
 * active color field (matching the original's matte outside-frame transition).
 */
const matteChromeFn = Fn(([r, dark]: readonly [V3, F]) => {
  const up = r.y;
  const col = mix(vec3(0.014, 0.015, 0.018), vec3(0.1, 0.105, 0.12), smoothstep(-0.25, 0.7, up));
  const horizon = float(1).sub(smoothstep(0.01, 0.18, abs(up.sub(0.03))));
  const top = smoothstep(0.5, 0.8, up).mul(float(1).sub(smoothstep(0.35, 0.65, abs(r.x.add(0.1)))));
  const key = smoothstep(0.45, 0.7, r.x).mul(float(1).sub(smoothstep(0.25, 0.5, abs(up.sub(0.1)))));
  const darkChrome = col
    .add(vec3(0.65, 0.68, 0.75).mul(horizon).mul(0.45))
    .add(vec3(0.85, 0.87, 0.92).mul(top).mul(0.7))
    .add(vec3(0.75, 0.78, 0.84).mul(key).mul(0.55))
    .mul(0.22);
  const darkMapped = vec3(1, 1, 1).sub(exp(darkChrome.mul(-1.6)));
  const lightMapped = mix(vec3(0.82, 0.84, 0.88), vec3(0.95, 0.96, 0.98), smoothstep(-0.3, 0.6, up))
    .mul(float(1).sub(horizon.mul(0.14)))
    .add(top.mul(0.05))
    .clamp(0, 1);
  return mix(lightMapped, darkMapped, dark);
}).setLayout({
  name: "kbPrismMatteChrome",
  type: "vec3",
  inputs: [
    { name: "r", type: "vec3" },
    { name: "dark", type: "float" },
  ],
});

const gridLineWithFw = (g: F, fw: F, weight: F): F => {
  const f = fract(g);
  const d = min(f, float(1).sub(f));
  const w = clamp(fw, float(0.002), float(0.28)).mul(weight);
  return float(1).sub(smoothstep(float(0), w, d));
};

/** Clean wireframe grid along `(surf.x, surf.y)` matching the original's lane density. */
function blueprintWire(surf: V2, surfFw: V2): F {
  const lineDensity = 18.16;
  const lanes = 10.0;
  const lineX = gridLineWithFw(surf.x.mul(lineDensity), surfFw.x.mul(lineDensity), float(0.9));
  const lineY = gridLineWithFw(
    surf.y.mul(0.5).add(0.5).mul(lanes),
    surfFw.y.mul(lanes * 0.5),
    float(0.9),
  );
  return max(lineX, lineY);
}

interface CodeSampleAt {
  readonly hp: V3;
  readonly surf: V2;
  readonly surfFw: V2;
  readonly stage: F;
  readonly mCode: F;
}

/** Curvature-projected SDF monospace shader code sampled with explicit LOD 0 (WGSL safe). */
function sampleProjectedCode(
  u: PrismRibbonUniforms,
  fonts: { readonly atlas: DataTexture; readonly code: DataTexture },
  { hp, surf, surfFw, stage, mCode }: CodeSampleAt,
): F {
  const atlasTex = texture(fonts.atlas);
  const codeTex = texture(fonts.code);
  const ink = float(0).toVar();
  If(mCode.greaterThan(0.005).and(u.codeGain.greaterThan(0.005)), () => {
    const numLines = float(18.0);
    const vNorm = surf.y.mul(0.5).add(0.5);
    const lineWorldH = float(2.0 * RIBBON_BASE_WIDTH).div(numLines);
    const hwHere = ribbonHalfWidthFn(hp.x, u.flow);
    const vLine = surf.y.mul(hwHere).div(lineWorldH).add(numLines.mul(0.5));
    const lineIdx = floor(vLine);
    const lineFrac = fract(vLine);
    const charAdv = lineWorldH.mul(0.54);
    const colFloat = surf.x.add(lineIdx.mul(0.37)).div(charAdv);
    const colIdx = floor(colFloat);
    const colFrac = fract(colFloat);
    const sdfAa = clamp(
      max(surfFw.x.div(charAdv), surfFw.y.mul(hwHere).div(lineWorldH)).mul(0.85),
      float(0.025),
      float(0.16),
    );

    const span = max(u.codeLen, float(1));
    const rawIdx = colIdx.add(lineIdx.mul(19.0));
    const baseIdx = mod(mod(rawIdx, span).add(span), span).toVar();
    // Crisp digital decode ONLY on the narrow materialization edge (stage 2.0..2.34).
    const cellRand = hash2(vec2(colIdx, lineIdx).add(floor(u.time.mul(8.0)).mul(3.17)));
    const revealEdge = float(1).sub(smoothstep(float(0), float(0.34), stage.sub(2.0)));
    const idx = select(
      cellRand.x.lessThan(revealEdge.mul(0.55)),
      floor(cellRand.y.mul(span)),
      baseIdx,
    );
    const codeU = clamp(idx, float(0), span.sub(1)).add(0.5).div(CODE_BUFFER_LEN);
    const ascii = floor(codeTex.sample(vec2(codeU, 0.5)).level(float(0)).r.mul(255.0).add(0.5));
    const inBounds = ascii
      .greaterThan(32.5)
      .and(ascii.lessThan(126.5))
      .and(vNorm.greaterThan(0.02))
      .and(vNorm.lessThan(0.98));
    If(inBounds, () => {
      const glyphIdx = ascii.sub(32.0);
      const atlasCol = mod(glyphIdx, float(ATLAS_COLS));
      const atlasRow = floor(glyphIdx.div(ATLAS_COLS));
      const padU = clamp(colFrac, float(0.01), float(0.99));
      const padV = clamp(float(1).sub(lineFrac), float(0.01), float(0.99));
      const atlasUv = vec2(atlasCol.add(padU).div(ATLAS_COLS), atlasRow.add(padV).div(ATLAS_ROWS));
      const sd = atlasTex.sample(atlasUv).level(float(0)).r;
      ink.assign(smoothstep(float(0.5).sub(sdfAa), float(0.5).add(sdfAa), sd));
    });
  });
  return ink;
}

/** Tight YZ-slab raymarch with exact post-loop Newton surface projection (zero text shimmer). */
function traceRibbon(u: PrismRibbonUniforms, camP: V2, zoom: F, roObj: V3, rdObj: V3) {
  const bound = float(0.68);
  const rdYz = vec2(rdObj.y, rdObj.z).add(vec2(1e-6, 1e-6));
  const t0 = vec2(bound.negate(), bound.negate()).sub(vec2(roObj.y, roObj.z)).div(rdYz);
  const t1 = vec2(bound, bound).sub(vec2(roObj.y, roObj.z)).div(rdYz);
  const tLo = min(t0, t1);
  const tHi = max(t0, t1);
  const tNear = max(max(tLo.x, tLo.y), float(2.2)).toVar();
  const tFar = min(min(tHi.x, tHi.y), float(5.15)).toVar();

  const pixelAngle = float(1).div(screenSize.y.mul(zoom).mul(FOCAL));
  // Deterministic start (no per-pixel random jitter) keeps 2×2 quad `fwidth(surf)` razor-clean.
  const tr = tNear.toVar();
  const minD = float(1000).toVar();
  const minT = tr.toVar();
  const hit = float(0).toVar();
  const hitD = float(0).toVar();

  const marches = tFar.greaterThan(tNear).and(abs(camP.y).lessThan(0.52));
  Loop({ start: 0, end: select(marches, u.steps, int(0)), type: "int", condition: "<" }, () => {
    If(tr.greaterThan(tFar), () => {
      Break();
    });
    const res = mapRibbonFn(roObj.add(rdObj.mul(tr)), u.flow).toVar();
    const d = res.x;
    If(d.lessThan(minD), () => {
      minD.assign(d);
      minT.assign(tr);
    });
    If(d.lessThan(HIT_EPS), () => {
      hit.assign(1);
      hitD.assign(d);
      Break();
    });
    tr.addAssign(max(d.mul(0.82), float(HIT_EPS)));
  });

  // One exact surface projection step eliminates per-pixel step-count depth jitter on `surf`.
  const hitT = select(hit.greaterThan(0.5), tr.add(hitD), minT);
  const hp = roObj.add(rdObj.mul(hitT)).toVar();
  const finalMap = mapRibbonFn(hp, u.flow).toVar();
  const surf = vec2(finalMap.y, finalMap.z).toVar();
  const px = max(float(HIT_EPS), minT.mul(pixelAngle));
  const exhausted = hit.lessThan(0.5).and(marches).and(tr.lessThanEqual(tFar));
  const covSmooth = float(1).sub(smoothstep(px.mul(0.25), px.mul(1.35), minD));
  const covExhaust = float(1).sub(smoothstep(float(0.01), float(0.028), minD));
  const cov = select(
    hit.greaterThan(0.5),
    float(1),
    select(exhausted, covExhaust, covSmooth),
  ).toVar();
  return { hp, minD, cov, surf };
}

interface ShadeInputs {
  readonly n: V3;
  readonly rd: V3;
  readonly pulseBand: F;
  readonly overlayMask: F;
}

/** Prismatic dark & light surface shading + traveling write-wave optical dispersion & typing calm. */
function shadeRibbonSurface(
  u: PrismRibbonUniforms,
  { n, rd, pulseBand, overlayMask }: ShadeInputs,
): { readonly dark: V3; readonly light: V3; readonly alpha: F; readonly hotCrest: F } {
  const ndv = max(dot(n, rd.negate()), float(0)).toVar();
  const fres = pow(float(1).sub(ndv), float(3.8)).toVar();

  // Typing polarizes & calms glare into cool velvet indigo; write wave widens local prism dispersion.
  const localPrism = u.prismGain
    .mul(float(1).add(pulseBand.mul(0.85)))
    .mul(float(1).sub(u.calm.mul(0.38)));
  const keyDir = normalize(
    vec2(
      float(0.65).add(u.pointer.x.mul(1.6)).add(pulseBand.mul(0.26)),
      float(0.76).add(u.pointer.y.mul(1.5)),
    ),
  );
  const perpKey = vec2(keyDir.y.negate(), keyDir.x);
  const across = dot(n.xy, perpKey).mul(0.38).mul(localPrism);
  const keyDot = dot(n.xy, keyDir);

  const facing = vec3(keyDot, keyDot, keyDot)
    .add(vec3(across, float(0), across.negate()))
    .add(ndv.mul(0.28))
    .add(pulseBand.mul(ndv).mul(0.28))
    .toVar();

  const obsidian = vec3(0.02, 0.042, 0.092);
  const cobaltMid = vec3(0.115, 0.215, 0.415);
  const sMid = smoothstep(vec3(-0.28, -0.26, -0.34), vec3(0.5, 0.54, 0.48), facing);
  const sHot = smoothstep(vec3(0.5, 0.56, 0.68), vec3(0.95, 1.02, 1.12), facing);

  const warmSpread = clamp(facing.x.sub(facing.z), float(0), float(1));
  const bronzeBand = warmSpread
    .mul(smoothstep(float(-0.18), float(0.38), facing.y))
    .mul(float(1).sub(smoothstep(float(0.52), float(0.92), facing.y)));
  const coralBand = warmSpread
    .mul(smoothstep(float(0.1), float(0.62), facing.x))
    .mul(float(1).sub(smoothstep(float(0.84), float(1.14), facing.y)));
  const crestSpec = smoothstep(float(0.5), float(0.96), facing.x.mul(0.45).add(facing.y.mul(0.55)));
  const crestCol = mix(
    vec3(1.0, 0.85, 0.5),
    vec3(1.0, 0.965, 0.84),
    smoothstep(float(0.38), float(0.92), sHot.y),
  );

  const upperCoralMask = smoothstep(float(0.04), float(0.62), n.y.sub(n.x.mul(0.35)));
  const rimCol = mix(vec3(0.24, 0.38, 0.68), vec3(0.96, 0.44, 0.48), upperCoralMask);

  const baseDark = mix(obsidian, cobaltMid, sMid).toVar();
  baseDark.addAssign(vec3(0.68, 0.46, 0.24).mul(bronzeBand).mul(0.68).mul(localPrism));
  baseDark.addAssign(vec3(0.98, 0.36, 0.46).mul(coralBand).mul(0.62).mul(localPrism));
  baseDark.assign(
    mix(
      baseDark,
      crestCol,
      clamp(sHot.mul(0.86).add(crestSpec.mul(0.26)), float(0), float(1)).mul(
        float(1).sub(u.calm.mul(0.56)),
      ),
    ),
  );
  baseDark.addAssign(
    rimCol
      .mul(fres.mul(0.3).add(upperCoralMask.mul(fres).mul(0.3)))
      .mul(float(1).sub(u.calm.mul(0.32))),
  );
  // Traveling chromatic caustic sheen riding the write wave along the curvature
  const caustic = pow(ndv, float(1.8)).mul(pulseBand);
  const causticCol = mix(vec3(0.56, 0.8, 1.0), vec3(1.0, 0.72, 0.6), smoothstep(-0.3, 0.5, n.y));
  baseDark.addAssign(causticCol.mul(caustic).mul(0.36));

  const codeTint = mix(vec3(0.92, 0.96, 1.0), vec3(1.0, 0.98, 0.92), crestSpec);
  const dark = mix(baseDark, codeTint, overlayMask.mul(0.84));

  const lightBase = mix(vec3(0.54, 0.62, 0.78), vec3(0.88, 0.91, 0.96), sMid).toVar();
  lightBase.assign(mix(lightBase, vec3(1.0, 0.98, 0.93), sHot.mul(float(1).sub(u.calm.mul(0.35)))));
  lightBase.assign(mix(lightBase, vec3(0.96, 0.74, 0.73), coralBand.mul(0.52).mul(localPrism)));
  lightBase.assign(mix(lightBase, vec3(0.96, 0.88, 0.74), bronzeBand.mul(0.35).mul(localPrism)));
  lightBase.assign(mix(lightBase, vec3(0.3, 0.4, 0.62), fres.mul(0.34)));
  lightBase.assign(mix(lightBase, vec3(0.98, 0.82, 0.76), caustic.mul(0.42)));
  const light = mix(
    lightBase,
    vec3(0.14, 0.24, 0.45),
    clamp(overlayMask.mul(0.76), float(0), float(0.86)),
  );

  return {
    dark,
    light,
    alpha: smoothstep(float(0.04), float(0.42), ndv),
    hotCrest: smoothstep(float(0.72), float(1.0), crestSpec)
      .add(caustic.mul(0.32))
      .mul(float(1).sub(u.calm.mul(0.6))),
  };
}

/** Screen-space Interleaved Gradient Noise (IGN) for fine 1px film grain & blue-noise dither. */
const ign = (st: V2): F =>
  fract(float(52.9829189).mul(fract(dot(st, vec2(0.06711056, 0.00583715)))));

/**
 * Two-layer photographic finish matching the original artwork's static IGN film
 * grain (`±0.025`) plus 10%-mixed animated 2-level blue-noise dither stipple,
 * strictly masked to the artwork so empty page ground stays completely clean.
 */
function applyArtworkGrainAndDither(
  srgb: V3,
  artMask: F,
  time: F,
  grainAmp: number,
  ditherMix: number,
): V3 {
  const px = floor(screenCoordinate.xy);
  const ignStatic = ign(px.add(vec2(17.0, 17.0))).toVar();
  // Mix static IGN with isotropic hash so 1px film grain has zero diagonal lattice at 2× DPR.
  const fineGrain = fract(ignStatic.add(hash(px.add(vec2(3.1, 7.3))).mul(0.5)));
  const grained = clamp(
    srgb.add(fineGrain.sub(0.5).mul(grainAmp).mul(artMask)),
    vec3(0, 0, 0),
    vec3(1, 1, 1),
  );
  // Isotropic high-frequency 1px stipple stepped cleanly with `u.time` (frozen under reduced motion).
  const step = floor(time.mul(2.0));
  const ditherNoise = hash(px.add(vec2(step.mul(123.0), step.mul(56.0))));
  const dithered = floor(grained.mul(2.0).add(ditherNoise)).div(2.0);
  return mix(grained, dithered, artMask.mul(ditherMix));
}

function composeSceneColor(
  u: PrismRibbonUniforms,
  grounds: Grounds,
  c: {
    readonly p: V2;
    readonly under: F;
    readonly fieldSrgb: V3;
    readonly shadowSoft: F;
    readonly haloCol: V3;
    readonly groundMask: F;
    readonly ribbonBottomFade: F;
    readonly cov: F;
    readonly bodyDarkSrgb: V3;
    readonly bodyLightSrgb: V3;
    readonly bodyAlpha: F;
    readonly hotCrest: F;
  },
): V3 {
  const { ground, page, paint } = grounds;
  const ribbonCov = c.cov.mul(c.bodyAlpha).mul(c.ribbonBottomFade).toVar();
  const artPresence = smoothstep(float(0.02), float(0.16), max(c.groundMask, ribbonCov)).toVar();
  // Keep page typography clean while giving the ribbon and field crisp 1px tactile grain.
  const grainMask = artPresence.mul(float(1).sub(c.under.mul(0.75))).toVar();

  // Post-composite luminous hover lift matching original `exp(-16 * d^2) * 0.306`:
  // illuminates BOTH the field and the ribbon + projected code into HDR bloom around the pointer.
  const toCursor = c.p.sub(u.cursor);
  const hoverW = exp(dot(toCursor, toCursor).mul(-14.0))
    .mul(0.34)
    .mul(u.pointer.z)
    .mul(artPresence)
    .toVar();

  // Dark composition: composite sRGB -> post-composite hover lift -> 2-layer grain/dither -> linear HDR.
  const darkFieldSrgb = c.fieldSrgb
    .mul(float(1).sub(c.shadowSoft))
    .add(c.haloCol)
    .mul(1.16)
    .mul(c.groundMask);
  const darkEdgeHaloSrgb = c.haloCol
    .mul(1.15)
    .mul(float(1).sub(c.cov))
    .mul(0.45)
    .mul(c.ribbonBottomFade);
  const darkArtSrgb = mix(darkFieldSrgb.add(darkEdgeHaloSrgb), c.bodyDarkSrgb, ribbonCov);
  const darkLiftedSrgb = mix(darkArtSrgb, darkArtSrgb.add(0.2).mul(2.0), hoverW).toVar();
  const darkBaseSrgb = clamp(darkLiftedSrgb, vec3(0, 0, 0), vec3(1, 1, 1));
  const darkHdrExcess = max(darkLiftedSrgb.sub(1.0), vec3(0, 0, 0));
  const darkTexturedSrgb = applyArtworkGrainAndDither(darkBaseSrgb, grainMask, u.time, 0.05, 0.1);
  const darkArtLin = toLinear(darkTexturedSrgb.add(darkHdrExcess));
  const darkScene = ground
    .mul(float(1).sub(ribbonCov))
    .add(darkArtLin)
    .add(vec3(0.32, 0.25, 0.12).mul(c.hotCrest.mul(c.hotCrest)).mul(ribbonCov));
  const shownDark = mix(
    ground,
    u.turn.mul(darkScene).max(vec3(0, 0, 0)),
    float(1).sub(c.under.mul(ribbonCov.oneMinus()).mul(0.24)),
  );

  // Light composition (ink/engraving watercolor wash + restrained hover lift & tactile print grain).
  const lightWashTint = mix(
    vec3(0.92, 0.94, 0.99),
    vec3(0.98, 0.92, 0.94),
    smoothstep(float(0.1), float(0.3), c.fieldSrgb.r),
  );
  const lightWash = mix(vec3(1, 1, 1), lightWashTint, c.groundMask.mul(0.88)).mul(
    float(1).sub(c.shadowSoft.mul(0.2).mul(c.ribbonBottomFade)),
  );
  const lightComped = mix(lightWash, c.bodyLightSrgb, ribbonCov.mul(0.95));
  const lightLifted = mix(lightComped, mix(lightComped, vec3(1, 1, 1), 0.36), hoverW);
  const lightTextured = applyArtworkGrainAndDither(lightLifted, grainMask, u.time, 0.032, 0.075);
  const lightGraded = mix(
    u.turn.mul(lightTextured).clamp(0, 1),
    vec3(1, 1, 1),
    c.under.mul(ribbonCov.oneMinus()).mul(0.22),
  );
  return mix(paint(page.mul(lightGraded)), shownDark, u.dark);
}

function evaluateRibbonBody(
  u: PrismRibbonUniforms,
  fonts: { readonly atlas: DataTexture; readonly code: DataTexture },
  hit: {
    readonly p: V2;
    readonly rd: V3;
    readonly hp: V3;
    readonly cov: F;
    readonly surf: V2;
    readonly surfFw: V2;
    readonly prismZone: F;
  },
) {
  const bodyDarkSrgb = vec3(0, 0, 0).toVar();
  const bodyLightSrgb = vec3(0.95, 0.96, 0.98).toVar();
  const bodyAlpha = float(0).toVar();
  const hotCrest = float(0).toVar();

  If(hit.cov.greaterThan(0.001), () => {
    const wire = blueprintWire(hit.surf, hit.surfFw);
    // Traveling write pulse band along ribbon spine `surf.x`
    const pulseDist = hit.surf.x.sub(u.writeWave.x).div(0.46);
    const pulseBand = exp(pulseDist.mul(pulseDist).negate()).mul(u.writeWave.y).toVar();
    const stage = maskStageFn(
      hit.surf,
      hit.p,
      u.cursor,
      u.pointer.z,
      u.time,
      pulseBand.mul(1.8),
    ).toVar();
    // High-frequency surface-space stipple dissolve (rides with ribbon, never swims or slices glyphs).
    const dissolveNoise = select(
      stage.greaterThan(0),
      gnoise(vec2(hit.surf.x.mul(75.0), hit.surf.y.mul(22.0)))
        .sub(0.5)
        .mul(0.55),
      float(0),
    );
    const mWire = smoothstep(float(-0.04), float(0.04), stage.sub(1.0).add(dissolveNoise));
    const mCode = smoothstep(float(-0.04), float(0.04), stage.sub(2.0).add(dissolveNoise));
    const ink = sampleProjectedCode(u, fonts, {
      hp: hit.hp,
      surf: hit.surf,
      surfFw: hit.surfFw,
      stage,
      mCode,
    });

    // Exclusive 3-stage progression matching original: wireframe dissolves cleanly into crisp code.
    const calmQuiet = float(1).sub(u.calm.mul(0.72));
    const overlayRaw = wire
      .mul(0.62)
      .mul(mWire)
      .mul(float(1).sub(mCode))
      .add(ink.mul(mCode).mul(0.96));
    const overlayMask = clamp(
      overlayRaw.mul(u.codeGain).mul(calmQuiet).mul(hit.prismZone),
      float(0),
      float(0.95),
    );
    const n = normalize(u.modelRot.mul(ribbonNormalFn(hit.hp, u.flow))).toVar();
    const shaded = shadeRibbonSurface(u, { n, rd: hit.rd, pulseBand, overlayMask });
    const matteDark = matteChromeFn(reflect(hit.rd, n), float(1));
    const matteLight = matteChromeFn(reflect(hit.rd, n), float(0));
    bodyDarkSrgb.assign(mix(matteDark, shaded.dark, hit.prismZone));
    bodyLightSrgb.assign(mix(matteLight, shaded.light, hit.prismZone));
    bodyAlpha.assign(shaded.alpha);
    hotCrest.assign(shaded.hotCrest.mul(hit.prismZone));
  });

  return { bodyDarkSrgb, bodyLightSrgb, bodyAlpha, hotCrest };
}

/** The complete single-pass scene node for `stage.scene.backgroundNode`. */
export function prismRibbonFrame(
  u: PrismRibbonUniforms,
  fonts: { readonly atlas: DataTexture; readonly code: DataTexture },
  scrim: ReturnType<typeof textScrim>,
  grounds: Grounds,
): V3 {
  return Fn(() => {
    const aspect = screenSize.x.div(screenSize.y);
    const p = vec2(screenUV.x.sub(0.5).mul(aspect), float(0.5).sub(screenUV.y)).toVar();
    const under = scrim.under(vec2(screenUV.x, float(1).sub(screenUV.y)));

    // Slightly lifted vertical framing & zoom=1.48 keeps the animated ribbon belly graceful.
    const zoom = float(1.48).mul(u.hero.z);
    const camP = p
      .sub(u.hero.xy)
      .sub(vec2(0.04, 0.025).mul(u.hero.z))
      .add(u.pointer.xy.mul(0.45))
      .div(zoom)
      .toVar();

    const ro = vec3(0, 0, CAMERA_Z);
    const rd = normalize(vec3(camP, FOCAL)).toVar();
    const roObj = u.invModelRot.mul(ro).toVar();
    const rdObj = u.invModelRot.mul(rd).toVar();

    const { hp, minD, cov, surf } = traceRibbon(u, camP, zoom, roObj, rdObj);
    // Derivatives MUST be evaluated outside non-uniform branches for WGSL uniformity.
    const surfFw = fwidth(surf).toVar();
    const dSurf = max(minD, float(0));

    // Layer 1: Atmospheric background field (dissolves cleanly into the page).
    const fieldQ = p
      .sub(u.hero.xy)
      .mul(0.95)
      .add(vec2(u.fieldPhase, u.fieldPhase.mul(-0.6)));
    const fieldSrgb = fieldColorDarkFn(fieldQ, u.time).toVar();
    const shadowSoft = exp(dSurf.mul(-4.8)).mul(0.24);
    const reachHalo = dSurf.div(HALO_R);
    const halo = exp(vec3(-4.0, -5.4, -7.8).mul(reachHalo)).mul(
      float(1).sub(smoothstep(float(0.68), float(1.0), reachHalo)),
    );
    const haloCol = vec3(0.45, 0.54, 0.78).mul(halo).mul(0.25);

    // Ground-only dissolve reach + analytic organic lower-edge modulation (zero straight cuts).
    const fieldLeft = dissolve(u.reach, p, u.time.mul(0.03)).toVar();
    const edgeOrganic = sin(p.x.mul(3.1).add(u.time.mul(0.25)))
      .mul(0.02)
      .add(cos(p.x.mul(5.7).sub(u.time.mul(0.18))).mul(0.012));
    const bottomField = smoothstep(float(-0.36), float(-0.02), p.y.add(edgeOrganic));
    const groundMask = fieldLeft.mul(bottomField).toVar();

    // Outside-frame ribbon transition (inspired by original matte studio silhouette):
    // where a deep belly dip reaches the bottom edge, shed prism+code -> dark matte -> page bg.
    const prismZone = smoothstep(float(-0.4), float(-0.15), p.y.add(edgeOrganic)).toVar();
    const ribbonBottomFade = smoothstep(
      float(-0.48),
      float(-0.25),
      p.y.add(edgeOrganic.mul(1.2)),
    ).toVar();

    // Layer 2 & 3: Prismatic 3D ribbon + progressive wireframe → code reveal.
    const body = evaluateRibbonBody(u, fonts, { p, rd, hp, cov, surf, surfFw, prismZone });

    return composeSceneColor(u, grounds, {
      p,
      under,
      fieldSrgb,
      shadowSoft,
      haloCol,
      groundMask,
      ribbonBottomFade,
      cov,
      ...body,
    });
  })();
}
