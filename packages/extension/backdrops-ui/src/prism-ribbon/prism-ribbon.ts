/**
 * Pure parameters, variation, framing reach and pointer spring for the Prism
 * ribbon backdrop (`prism-ribbon-scene.ts`, `prism-ribbon-shader.ts`).
 *
 * Kept free of WebGPU/DOM imports so every geometric and motion guarantee can
 * be unit-tested directly at multiple frame rates and seeds.
 */
import {
  PRISM_RIBBON_CODE_KNOB,
  PRISM_RIBBON_HUE_KNOB,
  PRISM_RIBBON_PRISM_KNOB,
} from "@kb/backdrops";
import { knobValue, type KnobValues } from "@kb/model";
import { reachWithin, type Reach } from "../gpu/dissolve";
import type { Anchor } from "../gpu/framing";
import { clamp, damp } from "../scene/math";
import { variation } from "../scene/seed";

/** The shader lines projected along the 3D ribbon curvature. */
export const PRISM_CODE_TEXT =
  "for (t = 0.; t < 8.; t += d) d = map(ro + rd * t); n = grad(p); uv = project(hit, n); ink = msdf(atlas, uv); col += ink * 0.5;  ";

/**
 * Curated resting flow phase where the twisted ribbon pinches cleanly at both
 * exits, swells into an upper-center crest, and sweeps into a deep lower belly.
 */
export const STILL_FLOW = 4.65;
/** Curated mask clock for the still frame so blueprint grid and code patches balance across the crest and belly. */
const STILL_MASK_TIME = 0.55;

/** Live tuning decoded from the backdrop's knobs. */
export interface PrismRibbonTuning {
  /** Hue rotation in radians. */
  readonly hue: number;
  /** Projected code & grid intensity multiplier. */
  readonly code: number;
  /** Prismatic dispersion width multiplier. */
  readonly prism: number;
}

export function prismRibbonTuning(knobs: KnobValues): PrismRibbonTuning {
  return {
    hue: (knobValue(knobs, PRISM_RIBBON_HUE_KNOB) * Math.PI) / 180,
    code: knobValue(knobs, PRISM_RIBBON_CODE_KNOB),
    prism: knobValue(knobs, PRISM_RIBBON_PRISM_KNOB),
  };
}

/** Seeded variation per page load (`variation(seed)`). */
export interface PrismRibbonVariation {
  /** Initial flow phase offset (radians); 0 under reduced motion for the curated still. */
  readonly flowStart: number;
  /** Initial mask drift offset; curated under reduced motion. */
  readonly maskStart: number;
  /** Subtle per-load hue shift (radians). */
  readonly hue: number;
  /** Subtle per-load background wash phase offset. */
  readonly fieldPhase: number;
  /** Subtle model pitch/yaw offsets (radians). */
  readonly tiltX: number;
  readonly tiltY: number;
}

export function prismRibbonVariation(seed: number, reducedMotion: boolean): PrismRibbonVariation {
  const vary = variation(seed);
  if (reducedMotion) {
    return {
      flowStart: STILL_FLOW,
      maskStart: STILL_MASK_TIME,
      hue: 0,
      fieldPhase: 0,
      tiltX: 0,
      tiltY: 0,
    };
  }
  return {
    flowStart: STILL_FLOW + vary.range("prism.flow", -0.55, 0.55),
    maskStart: STILL_MASK_TIME + vary.range("prism.mask", -1.4, 1.4),
    hue: vary.range("prism.hue", -0.09, 0.09),
    fieldPhase: vary.range("prism.field", -0.9, 0.9),
    tiltX: vary.range("prism.tiltX", -0.025, 0.025),
    tiltY: vary.range("prism.tiltY", -0.025, 0.025),
  };
}

/**
 * The atmospheric background field's dissolve reach around the ribbon's anchor.
 * Only the ground field uses this reach; the 3D ribbon floats whole above it.
 */
export function ribbonFieldReach(aspect: number, anchor: Anchor): Reach {
  const rx = Math.max(aspect * 0.62, 1.85 * anchor.scale);
  const ry = Math.min(0.495, 0.495 * Math.max(0.92, anchor.scale));
  return reachWithin(aspect, { x: anchor.x, y: anchor.y + 0.06 }, { x: rx, y: ry }, 0.62);
}

/** Eased pointer state: bounded lean in frame units + smooth proximity weight. */
export interface PointerRig {
  x: number;
  y: number;
  near: number;
}

/** Fast-attack, slow-release time constants (s): within 0.15–0.6 s per docs/backdrops.md. */
const POINTER_ATTACK = 0.24;
const POINTER_RELEASE = 0.52;
/** Bounded maximum pointer displacement (frame heights) so composition always holds. */
export const MAX_POINTER_LEAN = 0.085;

/**
 * Advance the pointer rig by `dt` seconds using exponential damping so the
 * trajectory is frame-rate independent (identical at 30 Hz and 120 Hz) and
 * settles cleanly without overshoot when the pointer leaves.
 */
export function stepPointerRig(
  rig: PointerRig,
  target: { readonly x: number; readonly y: number; readonly near: number },
  dt: number,
): PointerRig {
  if (dt <= 0) return rig;
  const clampedX = clamp(target.x, -1, 1) * MAX_POINTER_LEAN * target.near;
  const clampedY = clamp(target.y, -1, 1) * MAX_POINTER_LEAN * target.near;
  const rateX = Math.abs(clampedX) > Math.abs(rig.x) ? 1 / POINTER_ATTACK : 1 / POINTER_RELEASE;
  const rateY = Math.abs(clampedY) > Math.abs(rig.y) ? 1 / POINTER_ATTACK : 1 / POINTER_RELEASE;
  const rateNear = target.near > rig.near ? 1 / POINTER_ATTACK : 1 / POINTER_RELEASE;
  return {
    x: damp(rig.x, clampedX, rateX, dt),
    y: damp(rig.y, clampedY, rateY, dt),
    near: damp(rig.near, target.near, rateNear, dt),
  };
}

/** Maximum code buffer length encoded into the 1D GPU lookup texture. */
export const CODE_BUFFER_LEN = 256;

/** Encode an ASCII string into a 256×1 RGBA texel strip (`r` holds ASCII code 0..255). */
export function encodeCodeLine(text: string): {
  readonly data: Uint8Array;
  readonly length: number;
} {
  const data = new Uint8Array(CODE_BUFFER_LEN * 4);
  const length = Math.min(text.length, CODE_BUFFER_LEN - 1);
  for (let i = 0; i < length; i++) {
    const code = text.charCodeAt(i);
    data[i * 4] = code >= 32 && code <= 126 ? code : 32;
    data[i * 4 + 3] = 255;
  }
  return { data, length };
}
