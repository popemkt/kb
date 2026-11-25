/**
 * Shared ocean wave-swell coordinate & height field for Gliding (`gliding-shader.ts`,
 * `aircraft-rig.ts`, `seagulls.ts`): lets the ocean background, `WB-027`'s cast shadow,
 * and every seagull's soft shadow evaluate the EXACT same moving wave swells so all
 * shadows physically bend, stretch, and modulate across passing crests and troughs.
 */
import {
  Fn,
  clamp,
  float,
  floor,
  fract,
  mix,
  pow,
  sin,
  smoothstep,
  step,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import {
  MultiplyBlending,
  NormalBlending,
  Vector2,
  type Blending,
  type MeshBasicNodeMaterial,
} from "three/webgpu";
import type { TslNode } from "@kb/scene-gpu";
import { hash } from "../gpu/noise";
import type { ShadowBlendMode } from "./gliding-tuning";

type F = TslNode<"float">;
type V2 = TslNode<"vec2">;
type V3 = TslNode<"vec3">;

/** Flight heading (NE, ~40°): scrolling sample coordinates along +HEADING glides water toward SW. */
const HEADING_X = 0.766;
const HEADING_Y = 0.643;
/** Primary wave-crest & foam-current axis (~32° SW-to-NE diagonal). */
const BRUSH_COS = 0.848;
const BRUSH_SIN = 0.53;

/** Shared ocean wave uniforms synced every frame across ocean shader & all shadow receivers. */
export interface OceanWaveUniforms {
  readonly scroll: ReturnType<typeof makeFloatUniform>;
  readonly swellPhase: ReturnType<typeof makeFloatUniform>;
  readonly parallax: ReturnType<typeof makeFloatUniform>;
  /** Effective vehicle speed multiplier (drives shadow surface ripple & distortion intensity). */
  readonly speed: ReturnType<typeof makeFloatUniform>;
  readonly dolly: ReturnType<typeof makeVec2Uniform>;
  readonly origin: ReturnType<typeof makeVec2Uniform>;
  readonly anchor: ReturnType<typeof makeVec2Uniform>;
}

function makeFloatUniform(v: number) {
  return uniform(v);
}

function makeVec2Uniform() {
  return uniform(new Vector2(0, 0));
}

export function createOceanWaveUniforms(): OceanWaveUniforms {
  return {
    scroll: makeFloatUniform(0),
    swellPhase: makeFloatUniform(0),
    parallax: makeFloatUniform(1),
    speed: makeFloatUniform(1),
    dolly: makeVec2Uniform(),
    origin: makeVec2Uniform(),
    anchor: makeVec2Uniform(),
  };
}

const alignBrush = (p: V2): V2 =>
  vec2(p.x.mul(BRUSH_COS).add(p.y.mul(BRUSH_SIN)), p.y.mul(BRUSH_COS).sub(p.x.mul(BRUSH_SIN)));

const fastNoiseFn = Fn(([p]: readonly [V2]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const u = f.mul(f).mul(f.mul(-2).add(3));
  const a = hash(i);
  const b = hash(i.add(vec2(1, 0)));
  const c = hash(i.add(vec2(0, 1)));
  const d = hash(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}).setLayout({ name: "kbGlideWaveNoise", type: "float", inputs: [{ name: "p", type: "vec2" }] });

export interface WaveSample {
  /** Swell height in [0, 1]: 1 on sunlit wave crests, 0 in deep marine troughs. */
  readonly height: F;
  /** Signed directional swell + surface chop slope in [-1, 1] (refracts shadows at vehicle speed). */
  readonly slopeX: F;
  readonly slopeY: F;
  /** World-locked brush-aligned water coordinates rushing beneath the flying vehicle. */
  readonly waterBp: V2;
  /** Speed-coupled surface distortion gain (emphasizes vehicle groundspeed on the shadow). */
  readonly speedGain: F;
}

/**
 * Evaluate the live mid-water ocean swell height, fast capillary surface chop, and
 * world-locked water coordinates at a screen-frame point `p` so cast shadows visibly
 * ripple, stretch, and break across moving water at the exact speed of the vehicle.
 */
export function sampleOceanWaveAt(wave: OceanWaveUniforms, p: V2): WaveSample {
  const rel = p.sub(wave.anchor);
  const moved = rel.sub(wave.dolly);
  const midWp = moved
    .mul(2.55)
    .add(vec2(wave.scroll.mul(HEADING_X), wave.scroll.mul(HEADING_Y)))
    .add(wave.origin);
  const bp = alignBrush(midWp).toVar();
  const sp = wave.swellPhase;

  // Primary directional ocean swells + cross-wave undulation matching `gliding-shader.ts` scale.
  const qx = fastNoiseFn(bp.mul(vec2(0.38, 0.58)).add(vec2(sp.mul(0.55), sp.mul(-0.32)))).sub(0.5);
  const qy = fastNoiseFn(
    bp
      .mul(vec2(0.38, 0.58))
      .add(vec2(4.7, 2.3))
      .add(vec2(sp.mul(-0.42), sp.mul(0.5))),
  ).sub(0.5);

  const sc = vec2(bp.x.mul(0.62), bp.y.mul(1.75))
    .add(vec2(qx.mul(1.15), qy.mul(1.55)))
    .add(vec2(sp.mul(0.22), sp.mul(-0.36)))
    .toVar();

  const h0 = fastNoiseFn(sc)
    .mul(0.68)
    .add(
      sin(sc.y.mul(4.2).add(sc.x.mul(1.1)))
        .mul(0.16)
        .add(0.16),
    );
  const hx = fastNoiseFn(sc.add(vec2(0.14, 0)))
    .mul(0.68)
    .add(
      sin(sc.y.mul(4.2).add(sc.x.add(0.14).mul(1.1)))
        .mul(0.16)
        .add(0.16),
    );
  const hy = fastNoiseFn(sc.add(vec2(0, 0.14)))
    .mul(0.68)
    .add(
      sin(sc.y.add(0.14).mul(4.2).add(sc.x.mul(1.1)))
        .mul(0.16)
        .add(0.16),
    );

  // World-locked capillary surface chop rushing past beneath the cast shadow at exact flight speed.
  const chopCoord = vec2(bp.x.mul(2.8), bp.y.mul(7.6)).add(vec2(sp.mul(0.9), sp.mul(-1.4)));
  const chopX = fastNoiseFn(chopCoord).sub(0.5).mul(0.65);
  const chopY = fastNoiseFn(chopCoord.add(vec2(6.3, 2.9)))
    .sub(0.5)
    .mul(0.65);
  const speedGain = clamp(wave.speed.mul(0.45).add(0.62), 0.55, 1.85);

  return {
    height: clamp(h0, 0, 1),
    slopeX: clamp(hx.sub(h0).mul(3.4).add(chopX).mul(speedGain), -1.35, 1.35),
    slopeY: clamp(hy.sub(h0).mul(3.4).add(chopY).mul(speedGain), -1.35, 1.35),
    waterBp: bp,
    speedGain,
  };
}

/** Numeric shader index for `ShadowBlendMode` (`0` gouache/normal, `1` multiply, `2` ink wash, `3` deep burn). */
export function shadowBlendIndex(mode: ShadowBlendMode): number {
  if (mode === "normal") return 0;
  if (mode === "ink") return 2;
  if (mode === "burn") return 3;
  return 1;
}

/** Switch a shadow material between GPU `NormalBlending` and `MultiplyBlending` live. */
export function applyShadowBlending(mat: MeshBasicNodeMaterial, mode: ShadowBlendMode): void {
  const useMult = mode !== "normal";
  const next: Blending = useMult ? MultiplyBlending : NormalBlending;
  if (mat.blending !== next || mat.premultipliedAlpha !== useMult) {
    mat.blending = next;
    mat.premultipliedAlpha = useMult;
    mat.needsUpdate = true;
  }
}

export interface PainterlyShadowMask {
  readonly mask: F;
  readonly wetRim: F;
}

/**
 * Convert a soft blurred silhouette alpha into a painterly brush-broken gouache/watercolor
 * perimeter whose surface ripples and dry-brush streaks rush backward in exact lockstep
 * with the moving ocean water (`w.waterBp`), emphasizing the vehicle's forward speed.
 */
export function painterlyShadowEdge(
  rawAlpha: F,
  frameP: V2,
  w: WaveSample,
  softness: F,
): PainterlyShadowMask {
  // World-locked water coordinates make swells & ripples stream directly across the shadow edge at flight speed!
  const waterBp = w.waterBp;
  const soft = clamp(softness, 0, 2);
  const dabCoarse = fastNoiseFn(
    waterBp.mul(vec2(5.2, 13.5)).add(vec2(w.slopeX.mul(1.8), w.slopeY.mul(1.8))),
  ).sub(0.5);
  const dabDry = fastNoiseFn(waterBp.mul(vec2(14.5, 29.0)).add(vec2(4.1, 7.3))).sub(0.5);
  // Fine cold-press paper tooth stays stationary on the physical sheet while water streams underneath.
  const paperBreak = fastNoiseFn(frameP.mul(145.0).add(vec2(2.3, 9.7))).sub(0.5);

  const brushBreak = dabCoarse
    .mul(0.38)
    .add(dabDry.mul(0.28))
    .mul(w.speedGain)
    .add(paperBreak.mul(0.12));
  const edgeZone = rawAlpha.mul(float(1).sub(rawAlpha)).mul(4.0);
  const disturbed = rawAlpha.add(
    brushBreak.mul(float(0.36).add(soft.mul(0.54))).mul(float(0.24).add(edgeZone.mul(0.98))),
  );

  // Tighter painterly brush threshold instead of a wide foggy Gaussian ramp.
  const softT = clamp(soft.mul(0.5), 0, 1);
  const lo = mix(float(0.26), float(0.12), softT);
  const hi = mix(float(0.42), float(0.68), softT);
  const mask = smoothstep(lo, hi, disturbed);
  const wetRim = mask.mul(float(1).sub(mask)).mul(4.0);
  return { mask, wetRim };
}

/**
 * Compose `colorNode` and `opacityNode` for all 4 shadow blend modes (`normal`, `multiply`,
 * `ink`, `burn`) so both `NormalBlending` and `MultiplyBlending` stay artifact-free in Dark & Light modes.
 */
export function composeShadowBlend(opts: {
  readonly mode: F;
  readonly dark: F;
  readonly waveHeight: F;
  readonly opacity: F;
  readonly wetRim: F;
  readonly normalColor: V3;
}): { readonly color: V3; readonly opacity: F } {
  const isMult = step(0.5, opts.mode);
  const isInk = step(1.5, opts.mode).mul(float(1).sub(step(2.5, opts.mode)));
  const isBurn = step(2.5, opts.mode);

  // Multiplicative ocean-shadow tints: deeper Prussian-cyan in troughs, lighter turquoise-teal over crests.
  const troughMult = mix(vec3(0.32, 0.56, 0.68), vec3(0.14, 0.34, 0.5), opts.dark);
  const crestMult = mix(vec3(0.56, 0.76, 0.84), vec3(0.28, 0.54, 0.68), opts.dark);
  const baseMult = mix(troughMult, crestMult, opts.waveHeight.mul(0.55));
  // Ink wash deepens the perimeter into a wet-edge watercolor pooling ring.
  const inkMult = clamp(
    baseMult.mul(vec3(0.84, 0.88, 0.92)).mul(float(1).sub(opts.wetRim.mul(0.42))),
    vec3(0.03, 0.08, 0.14),
    vec3(1, 1, 1),
  );
  // Deep burn increases contrast & cobalt saturation across sunlit water.
  const burnMult = clamp(
    pow(baseMult, vec3(1.65, 1.52, 1.38)),
    vec3(0.02, 0.06, 0.12),
    vec3(1, 1, 1),
  );
  const activeMult = mix(mix(baseMult, inkMult, isInk), burnMult, isBurn);

  const multAlpha = clamp(
    opts.opacity.mul(float(1).add(isInk.mul(0.14)).add(isBurn.mul(0.2))),
    0,
    0.96,
  );
  const multCol = mix(vec3(1, 1, 1), activeMult, multAlpha);

  return {
    color: mix(opts.normalColor, multCol, isMult),
    opacity: mix(opts.opacity, float(1), isMult),
  };
}
