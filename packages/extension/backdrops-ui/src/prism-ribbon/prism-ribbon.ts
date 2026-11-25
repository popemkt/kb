/**
 * Pure parameters, variation, framing reach, pointer spring and write-wave
 * state for the Prism ribbon backdrop (`prism-ribbon-scene.ts`,
 * `prism-ribbon-shader.ts`).
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
/**
 * Curated mask clock for the still frame so the progressive wireframe → code
 * reveal sits gracefully across the central crest and belly.
 */
const STILL_MASK_TIME = 1.15;

/**
 * Real-time clock rates matching the original artwork's pacing ratio
 * (`uTime` at `0.19 × 60 = 11.4/s` → `time = 0.57/s`, `flow = time × 0.749`).
 */
export const TIME_RATE = 0.57;
export const FLOW_RATIO = 0.749;

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
  /** Initial flow phase offset (radians); curated under reduced motion. */
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
    tiltX: vary.range("prism.tiltX", -0.022, 0.022),
    tiltY: vary.range("prism.tiltY", -0.022, 0.022),
  };
}

/**
 * The atmospheric background field's dissolve reach around the ribbon's anchor.
 * Only the ground field uses this reach; the 3D ribbon floats above it and
 * transitions into a matte bg-tinted silhouette where it dips past the field.
 */
export function ribbonFieldReach(aspect: number, anchor: Anchor): Reach {
  const rx = Math.max(aspect * 0.62, 1.85 * anchor.scale);
  const ry = Math.min(0.495, 0.495 * Math.max(0.92, anchor.scale));
  return reachWithin(aspect, { x: anchor.x, y: anchor.y + 0.06 }, { x: rx, y: ry }, 0.62);
}

/** Eased pointer state: bounded lean in frame units, smooth cursor position, and proximity weight. */
export interface PointerRig {
  readonly x: number;
  readonly y: number;
  readonly cursorX: number;
  readonly cursorY: number;
  readonly near: number;
}

/** Fast-attack, slow-release time constants (s): within 0.15–0.6 s per docs/backdrops.md. */
const POINTER_ATTACK = 0.24;
const POINTER_RELEASE = 0.52;
/** Matches the original artwork's `mouseMomentum: 0.7` gliding inertia (frame-rate independent). */
const CURSOR_FOLLOW = 0.24;
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
  const cx = target.near > 0.01 ? damp(rig.cursorX, target.x, 1 / CURSOR_FOLLOW, dt) : rig.cursorX;
  const cy = target.near > 0.01 ? damp(rig.cursorY, target.y, 1 / CURSOR_FOLLOW, dt) : rig.cursorY;
  return {
    x: damp(rig.x, clampedX, rateX, dt),
    y: damp(rig.y, clampedY, rateY, dt),
    cursorX: cx,
    cursorY: cy,
    near: damp(rig.near, target.near, rateNear, dt),
  };
}

/**
 * A traveling optical prism + code wave along the ribbon spine (`surf.x`)
 * driven by page writes (`reactions.stir`). Runs forward continuously so a new
 * write energizes the wave without ever resetting or snapping.
 */
export interface WriteWave {
  /** Spine x position of the wave crest in object space (`-2.4 .. +2.4`). */
  readonly x: number;
  /** Current optical energy (0..1), rising smoothly on a write and fading after crossing. */
  readonly energy: number;
  /** Whether the wave is currently armed to re-enter from the left on the next write. */
  readonly armed: boolean;
}

const WAVE_START_X = -1.95;
const WAVE_END_X = 2.2;
const WAVE_SPEED = 2.8;

export function stepWriteWave(wave: WriteWave, stir: number, dt: number): WriteWave {
  if (dt <= 0) return wave;
  let { x, energy, armed } = wave;
  if (armed && stir > 0.22) {
    // Launch smoothly from the left pinch when quiet; if already crossing, re-energize cleanly.
    if (energy < 0.08 || x >= WAVE_END_X - 0.15) x = WAVE_START_X;
    armed = false;
  } else if (!armed && stir < 0.12) {
    armed = true;
  }
  const sustain = energy * Math.exp(-dt * 0.45);
  const targetEnergy = x < WAVE_END_X ? Math.max(Math.min(1, stir * 1.35), sustain) : 0;
  energy = damp(energy, targetEnergy, targetEnergy > energy ? 18 : 2.0, dt);
  if (energy > 0.004) {
    x = Math.min(WAVE_END_X, x + dt * WAVE_SPEED);
  }
  if (x >= WAVE_END_X) {
    energy = damp(energy, 0, 5.5, dt);
  }
  return { x, energy: energy < 0.002 ? 0 : energy, armed };
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
