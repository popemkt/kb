/**
 * Prism ribbon shader (T1): a single-pass raymarched 3D twisted iridescent
 * membrane floating above a dissolving midnight-navy & warm-plum field,
 * inscribed with curvature-projected technical blueprint lines and crisp SDF
 * monospace shader code.
 *
 * Passes per frame:
 * 1. Scene backgroundNode (this shader): background field + dissolve, tight YZ
 *    AABB raymarch of the twisted ribbon SDF, tetrahedral normals, prismatic
 *    RGB-split specular lighting, curvature-projected blueprint grid + ticks,
 *    and SDF monospace code reveal.
 * 2. Stage bloom (dark mode only, catching only the hottest cream-gold crests).
 * 3. Stage composite (shoulder tone curve, edge feather, IGN dither, film grain).
 *
 * WGSL uniformity: `fwidth(surf)` is evaluated outside non-uniform branches,
 * and all texture fetches inside branches use explicit `.level(float(0))`.
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
  screenCoordinate,
  screenSize,
  screenUV,
  select,
  sin,
  smoothstep,
  step,
  texture,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import { Matrix3, Vector2, Vector3, type DataTexture } from "three/webgpu";
import type { TslNode } from "@kb/scene-gpu";
import { dissolve, dissolveUniforms } from "../gpu/dissolve";
import type { Grounds } from "../gpu/gpu-scene";
import { gnoise, hash2 } from "../gpu/noise";
import type { textScrim } from "../gpu/text-scrim";
import { CODE_BUFFER_LEN } from "./prism-ribbon";
import { ATLAS_COLS, ATLAS_ROWS } from "./sdf-font";

type F = TslNode<"float">;
type V2 = TslNode<"vec2">;
type V3 = TslNode<"vec3">;

const PI = Math.PI;
const RIBBON_BASE_WIDTH = 0.252;
const RIBBON_FREQ_X = 1.72;
const RIBBON_AMP = 0.33;
const RIBBON_TWIST_K = 0.936;
const RIBBON_BULGE_K = 0.364;
const FOCAL = 1.8;
const CAMERA_Z = -3.4;
const HIT_EPS = 0.0018;
const HALO_R = 0.32;

export function prismRibbonUniforms() {
  return {
    /** Ribbon undulation/flow clock (curated around STILL_FLOW). */
    flow: uniform(4.65),
    /** Mask & background wash clock. */
    time: uniform(0.55),
    /** 1 for dark page, 0 for light page. */
    dark: uniform(1),
    /** Hero anchor in frame units: (x, y, scale). */
    hero: uniform(new Vector3(0, 0, 1)),
    /** Bounded eased pointer lean in frame units: (x, y, near). */
    pointer: uniform(new Vector3(0, 0, 0)),
    /** Cursor position in frame units for subtle highlight/code reveal lift. */
    cursor: uniform(new Vector2(0, 0)),
    /** Adaptive max raymarch steps (28 at full quality, 18 at floor). */
    steps: uniform(28, "int"),
    /** Model rotation & its transpose (updated on CPU from base tilt + pointer + seed). */
    modelRot: uniform(new Matrix3()),
    invModelRot: uniform(new Matrix3()),
    /** Hue turn matrix (seed + hue knob). */
    turn: uniform(new Matrix3()),
    /** Projected code & grid overlay intensity multiplier. */
    codeGain: uniform(1),
    /** Prismatic dispersion width multiplier. */
    prismGain: uniform(1),
    /** Write impulse shimmer (0..1). */
    impulse: uniform(0),
    /** Seeded background field phase offset. */
    fieldPhase: uniform(0),
    /** Encoded code line length in characters. */
    codeLen: uniform(128),
    /** Ground field dissolve reach (ground only — never clips the 3D ribbon). */
    reach: dissolveUniforms(),
  };
}
export type PrismRibbonUniforms = ReturnType<typeof prismRibbonUniforms>;

const ign = (st: V2): F =>
  fract(float(52.9829189).mul(fract(dot(st, vec2(0.06711056, 0.00583715)))));

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
  const e = float(0.0014);
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

/** Multi-octave organic reveal mask along the ribbon surface. */
const maskStageFn = Fn(([surf, pFrame, cursor, near, time]: readonly [V2, V2, V2, F, F]) => {
  const drift = time.mul(0.42);
  const xCoord = surf.x.mul(1.25).sub(drift);
  const pNoise = vec2(xCoord.mul(1.05), surf.y.mul(2.15));
  const n1 = gnoise(pNoise).mul(2).sub(1);
  const n2 = gnoise(pNoise.mul(2.17).add(vec2(drift.mul(-0.2), 1.4)))
    .mul(2)
    .sub(1);
  const n3 = gnoise(pNoise.mul(4.31).add(vec2(drift.mul(0.3), 3.1)))
    .mul(2)
    .sub(1);
  const noiseVal = n1.mul(0.54).add(n2.mul(0.32)).add(n3.mul(0.14));
  const wave = cos(xCoord.mul(PI * 0.42).sub(0.25));
  const combined = wave.mul(0.55).add(noiseVal.mul(1.18));
  const toCursor = pFrame.sub(cursor);
  const cursorLift = exp(dot(toCursor, toCursor).mul(-9.0)).mul(0.95).mul(near);
  const raw = combined.add(0.22).add(cursorLift);
  return select(raw.greaterThan(0), raw.mul(2.75), float(-1));
}).setLayout({
  name: "kbPrismMaskStage",
  type: "float",
  inputs: [
    { name: "surf", type: "vec2" },
    { name: "pFrame", type: "vec2" },
    { name: "cursor", type: "vec2" },
    { name: "near", type: "float" },
    { name: "time", type: "float" },
  ],
});

/** Deep midnight navy-blue blended with warm dark plum/burgundy radial corner washes. */
const fieldColorDarkFn = Fn(([q, t]: readonly [V2, F]) => {
  const w1 = sin(q.x.mul(1.85).add(q.y.mul(1.65)).add(t.mul(0.14)).add(0.65))
    .mul(0.5)
    .add(0.5);
  const w2raw = sin(q.y.mul(2.45).sub(q.x.mul(1.45)).sub(t.mul(0.11)).add(1.3))
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

const gridLineWithFw = (g: F, fw: F, weight: F): F => {
  const f = fract(g);
  const d = min(f, float(1).sub(f));
  const w = clamp(fw, float(0.002), float(0.28)).mul(weight);
  return float(1).sub(smoothstep(float(0), w, d));
};

/** Blueprint grid lines, ruler micro-ticks and crosshair intersections along `(surf.x, surf.y)`. */
function blueprintWire(surf: V2, surfFw: V2): F {
  const gridX = surf.x.mul(15.5);
  const gridY = surf.y.mul(0.5).add(0.5).mul(8.5);
  const fwGridX = surfFw.x.mul(15.5);
  const fwGridY = surfFw.y.mul(4.25);
  const lineX = gridLineWithFw(gridX, fwGridX, float(0.9));
  const lineY = gridLineWithFw(gridY, fwGridY, float(0.9));
  const wirePrimary = max(lineX, lineY);
  const subTickX = gridLineWithFw(gridX.mul(4.0), fwGridX.mul(4.0), float(0.85)).mul(
    step(min(fract(gridY), float(1).sub(fract(gridY))), float(0.1)),
  );
  const subTickY = gridLineWithFw(gridY.mul(4.0), fwGridY.mul(4.0), float(0.85)).mul(
    step(min(fract(gridX), float(1).sub(fract(gridX))), float(0.08)),
  );
  const crosshair = step(min(fract(gridX), float(1).sub(fract(gridX))), float(0.14))
    .mul(lineY)
    .max(step(min(fract(gridY), float(1).sub(fract(gridY))), float(0.14)).mul(lineX));
  return clamp(
    wirePrimary.mul(0.72).add(max(subTickX, subTickY).mul(0.32)).add(crosshair.mul(0.42)),
    float(0),
    float(1),
  );
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
    const numLines = float(21.0);
    const vNorm = surf.y.mul(0.5).add(0.5);
    const lineWorldH = float(2.0 * RIBBON_BASE_WIDTH).div(numLines);
    const hwHere = ribbonHalfWidthFn(hp.x, u.flow);
    const vLine = surf.y.mul(hwHere).div(lineWorldH).add(numLines.mul(0.5));
    const lineIdx = floor(vLine);
    const lineFrac = fract(vLine);
    const charAdv = lineWorldH.mul(0.56);
    const colFloat = surf.x.add(lineIdx.mul(0.37)).div(charAdv);
    const colIdx = floor(colFloat);
    const colFrac = fract(colFloat);
    const sdfAa = clamp(
      max(surfFw.x.div(charAdv), surfFw.y.mul(hwHere).div(lineWorldH)).mul(1.15),
      float(0.02),
      float(0.26),
    );

    const span = max(u.codeLen, float(1));
    const rawIdx = colIdx.add(lineIdx.mul(19.0));
    const baseIdx = mod(mod(rawIdx, span).add(span), span).toVar();
    const cellRand = hash2(vec2(colIdx, lineIdx).add(floor(u.time.mul(6.0)).mul(3.17)));
    const revealEdge = float(1).sub(smoothstep(float(0), float(0.45), stage.sub(1.65)));
    const idx = select(
      cellRand.x.lessThan(revealEdge.mul(0.5)),
      floor(cellRand.y.mul(span)),
      baseIdx,
    );
    const codeU = clamp(idx, float(0), span.sub(1)).add(0.5).div(CODE_BUFFER_LEN);
    const ascii = floor(codeTex.sample(vec2(codeU, 0.5)).level(float(0)).r.mul(255.0).add(0.5));
    const inBounds = ascii
      .greaterThan(32.5)
      .and(ascii.lessThan(126.5))
      .and(vNorm.greaterThan(0.03))
      .and(vNorm.lessThan(0.97));
    If(inBounds, () => {
      const glyphIdx = ascii.sub(32.0);
      const atlasCol = mod(glyphIdx, float(ATLAS_COLS));
      const atlasRow = floor(glyphIdx.div(ATLAS_COLS));
      const padU = clamp(colFrac.mul(0.88).add(0.06), float(0.02), float(0.98));
      const padV = clamp(float(1).sub(lineFrac).mul(0.88).add(0.06), float(0.02), float(0.98));
      const atlasUv = vec2(atlasCol.add(padU).div(ATLAS_COLS), atlasRow.add(padV).div(ATLAS_ROWS));
      const sd = atlasTex.sample(atlasUv).level(float(0)).r;
      ink.assign(smoothstep(float(0.5).sub(sdfAa), float(0.5).add(sdfAa), sd));
    });
  });
  return ink;
}

/** Tight YZ-slab raymarch returning hit distance, coverage, min SDF distance and surface UVs. */
function traceRibbon(u: PrismRibbonUniforms, camP: V2, zoom: F, roObj: V3, rdObj: V3) {
  const bound = float(0.74);
  const rdYz = vec2(rdObj.y, rdObj.z).add(vec2(1e-6, 1e-6));
  const t0 = vec2(bound.negate(), bound.negate()).sub(vec2(roObj.y, roObj.z)).div(rdYz);
  const t1 = vec2(bound, bound).sub(vec2(roObj.y, roObj.z)).div(rdYz);
  const tLo = min(t0, t1);
  const tHi = max(t0, t1);
  const tNear = max(max(tLo.x, tLo.y), float(2.1)).toVar();
  const tFar = min(min(tHi.x, tHi.y), float(5.35)).toVar();

  const pixelAngle = float(1).div(screenSize.y.mul(zoom).mul(FOCAL));
  const tr = max(tNear.sub(0.18), float(2.0)).add(ign(screenCoordinate.xy).mul(0.18)).toVar();
  const minD = float(1000).toVar();
  const minT = tr.toVar();
  const hit = float(0).toVar();
  const surf = vec2(0, 0).toVar();

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
      surf.assign(vec2(res.y, res.z));
    });
    If(d.lessThan(HIT_EPS), () => {
      hit.assign(1);
      surf.assign(vec2(res.y, res.z));
      Break();
    });
    tr.addAssign(max(d.mul(0.82), float(HIT_EPS)));
  });

  const hitT = select(hit.greaterThan(0.5), tr, minT);
  const px = max(float(HIT_EPS), minT.mul(pixelAngle));
  const exhausted = hit.lessThan(0.5).and(marches).and(tr.lessThanEqual(tFar));
  const covSmooth = float(1).sub(smoothstep(px.mul(0.25), px.mul(1.35), minD));
  const covExhaust = float(1).sub(smoothstep(float(0.01), float(0.028), minD));
  const cov = select(
    hit.greaterThan(0.5),
    float(1),
    select(exhausted, covExhaust, covSmooth),
  ).toVar();
  return { hitT, minD, cov, surf };
}

/** Prismatic dark & light surface shading + curvature-projected blueprint/code overlay. */
function shadeRibbonSurface(
  u: PrismRibbonUniforms,
  n: V3,
  rd: V3,
  mBorder: F,
  overlayMask: F,
): { readonly dark: V3; readonly light: V3; readonly alpha: F; readonly hotCrest: F } {
  const ndv = max(dot(n, rd.negate()), float(0)).toVar();
  const fres = pow(float(1).sub(ndv), float(3.8)).toVar();

  const keyDir = normalize(
    vec2(float(0.65).add(u.pointer.x.mul(1.6)), float(0.76).add(u.pointer.y.mul(1.5))),
  );
  const perpKey = vec2(keyDir.y.negate(), keyDir.x);
  const across = dot(n.xy, perpKey).mul(0.38).mul(u.prismGain);
  const keyDot = dot(n.xy, keyDir);

  const facing = vec3(keyDot, keyDot, keyDot)
    .add(vec3(across, float(0), across.negate()))
    .add(ndv.mul(0.28))
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
  baseDark.addAssign(vec3(0.68, 0.46, 0.24).mul(bronzeBand).mul(0.68).mul(u.prismGain));
  baseDark.addAssign(vec3(0.98, 0.36, 0.46).mul(coralBand).mul(0.62).mul(u.prismGain));
  baseDark.assign(
    mix(baseDark, crestCol, clamp(sHot.mul(0.86).add(crestSpec.mul(0.26)), float(0), float(1))),
  );
  baseDark.addAssign(rimCol.mul(fres.mul(0.3).add(upperCoralMask.mul(fres).mul(0.3))));
  baseDark.addAssign(vec3(0.85, 0.72, 0.62).mul(mBorder).mul(u.impulse.mul(0.14)));

  const codeTint = mix(vec3(0.9, 0.95, 1.0), vec3(1.0, 0.97, 0.88), crestSpec);
  const dark = mix(baseDark, codeTint, overlayMask.mul(0.64));

  const lightBase = mix(vec3(0.54, 0.62, 0.78), vec3(0.88, 0.91, 0.96), sMid).toVar();
  lightBase.assign(mix(lightBase, vec3(1.0, 0.98, 0.93), sHot));
  lightBase.assign(mix(lightBase, vec3(0.96, 0.74, 0.73), coralBand.mul(0.52).mul(u.prismGain)));
  lightBase.assign(mix(lightBase, vec3(0.96, 0.88, 0.74), bronzeBand.mul(0.35).mul(u.prismGain)));
  lightBase.assign(mix(lightBase, vec3(0.3, 0.4, 0.62), fres.mul(0.34)));
  const light = mix(
    lightBase,
    vec3(0.14, 0.24, 0.45),
    clamp(overlayMask.mul(0.68), float(0), float(0.84)),
  );

  return {
    dark,
    light,
    alpha: smoothstep(float(0.04), float(0.42), ndv),
    hotCrest: smoothstep(float(0.72), float(1.0), crestSpec),
  };
}

/** The complete single-pass scene node for `stage.scene.backgroundNode`. */
export function prismRibbonFrame(
  u: PrismRibbonUniforms,
  fonts: { readonly atlas: DataTexture; readonly code: DataTexture },
  scrim: ReturnType<typeof textScrim>,
  { ground, page, paint }: Grounds,
): V3 {
  return Fn(() => {
    const aspect = screenSize.x.div(screenSize.y);
    const p = vec2(screenUV.x.sub(0.5).mul(aspect), float(0.5).sub(screenUV.y)).toVar();
    const under = scrim.under(vec2(screenUV.x, float(1).sub(screenUV.y)));

    const zoom = float(1.62).mul(u.hero.z);
    const camP = p
      .sub(u.hero.xy)
      .sub(vec2(0.04, -0.02).mul(u.hero.z))
      .add(u.pointer.xy.mul(0.45))
      .div(zoom)
      .toVar();

    const ro = vec3(0, 0, CAMERA_Z);
    const rd = normalize(vec3(camP, FOCAL)).toVar();
    const roObj = u.invModelRot.mul(ro).toVar();
    const rdObj = u.invModelRot.mul(rd).toVar();

    const { hitT, minD, cov, surf } = traceRibbon(u, camP, zoom, roObj, rdObj);
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

    // Layer 2 & 3: Prismatic 3D ribbon + curvature-projected grid & SDF code.
    const bodyDarkSrgb = vec3(0, 0, 0).toVar();
    const bodyLightSrgb = vec3(0.95, 0.96, 0.98).toVar();
    const bodyAlpha = float(0).toVar();
    const hotCrest = float(0).toVar();

    If(cov.greaterThan(0.001), () => {
      const hp = roObj.add(rdObj.mul(hitT)).toVar();
      const wire = blueprintWire(surf, surfFw);
      const stage = maskStageFn(surf, p, u.cursor, u.pointer.z, u.time).toVar();
      const dissolveNoise = gnoise(camP.mul(46.0)).sub(0.5).mul(0.28);
      const mBorder = smoothstep(float(-0.04), float(0.04), stage);
      const mWire = smoothstep(float(-0.05), float(0.05), stage.sub(0.85).add(dissolveNoise));
      const mCode = smoothstep(float(-0.05), float(0.05), stage.sub(1.65).add(dissolveNoise));
      const ink = sampleProjectedCode(u, fonts, { hp, surf, surfFw, stage, mCode });

      const gridAlpha = wire
        .mul(0.48)
        .mul(mWire)
        .mul(float(1).sub(mCode.mul(0.18)));
      const overlayMask = clamp(
        max(gridAlpha, ink.mul(mCode).mul(0.76)).mul(u.codeGain),
        float(0),
        float(0.9),
      );
      const n = normalize(u.modelRot.mul(ribbonNormalFn(hp, u.flow))).toVar();
      const shaded = shadeRibbonSurface(u, n, rd, mBorder, overlayMask);
      bodyDarkSrgb.assign(shaded.dark);
      bodyLightSrgb.assign(shaded.light);
      bodyAlpha.assign(shaded.alpha);
      hotCrest.assign(shaded.hotCrest);
    });

    // Ground-only dissolve: never clips the 3D ribbon floating above it.
    const groundMask = dissolve(u.reach, p, u.time.mul(0.03))
      .mul(smoothstep(float(-0.48), float(-0.08), p.y))
      .toVar();
    const toCursor = p.sub(u.cursor);
    const cursorGlow = exp(dot(toCursor, toCursor).mul(-10.0)).mul(0.18).mul(u.pointer.z);

    // Dark composition (linear HDR + subtle crest boost for stage bloom).
    const darkFieldLin = toLinear(
      fieldSrgb.mul(float(1).sub(shadowSoft)).add(haloCol).mul(float(1.16).add(cursorGlow)),
    );
    const darkRibbonHdr = toLinear(bodyDarkSrgb).add(
      vec3(0.42, 0.34, 0.16).mul(hotCrest.mul(hotCrest)).mul(bodyAlpha),
    );
    const ribbonCov = cov.mul(bodyAlpha);
    const darkBg = mix(ground, ground.add(darkFieldLin), groundMask);
    const darkEdgeHalo = toLinear(haloCol.mul(1.15)).mul(float(1).sub(cov)).mul(0.45);
    const darkScene = mix(darkBg.add(darkEdgeHalo), darkRibbonHdr, ribbonCov);
    const shownDark = mix(
      ground,
      u.turn.mul(darkScene).max(vec3(0, 0, 0)),
      float(1).sub(under.mul(ribbonCov.oneMinus()).mul(0.24)),
    );

    // Light composition (ink/engraving watercolor wash on page paper).
    const lightWashTint = mix(
      vec3(0.92, 0.94, 0.99),
      vec3(0.98, 0.92, 0.94),
      smoothstep(float(0.1), float(0.3), fieldSrgb.r),
    );
    const lightWash = mix(vec3(1, 1, 1), lightWashTint, groundMask.mul(0.88)).mul(
      float(1).sub(shadowSoft.mul(0.2)),
    );
    const lightComposed = mix(lightWash, bodyLightSrgb, ribbonCov.mul(0.95));
    const lightGraded = mix(
      u.turn.mul(lightComposed).clamp(0, 1),
      vec3(1, 1, 1),
      under.mul(ribbonCov.oneMinus()).mul(0.22),
    );
    return mix(paint(page.mul(lightGraded)), shownDark, u.dark);
  })();
}
