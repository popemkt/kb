/**
 * Gliding's pure tuning and motion math (`gliding-scene.ts`, `gliding-shader.ts`):
 * maps knob values to shader uniforms and steps the ocean's calm gliding scroll
 * and damped camera dolly lean in a strictly frame-rate-independent way.
 */
import { GLIDING_FOAM_KNOB, GLIDING_SUN_WARMTH_KNOB } from "@kb/backdrops";
import { knobValue, type KnobValues } from "@kb/model";

/** World-space ocean glide speed (world units per second along the flight heading). */
export const GLIDE_SPEED = 0.22;
/** Relative rate at which swells, foam ribbons and caustics evolve as they glide. */
export const GLIDE_PHASE_RATIO = 0.18;
/** Maximum camera dolly lean in frame heights (horizontal and vertical). */
export const DOLLY_MAX = { x: 0.055, y: 0.032 } as const;
/** Exponential damping rates (1/s): faster attack when pointer enters, slower calm release. */
const DOLLY_ATTACK = 3.6;
const DOLLY_RELEASE = 2.1;

export interface GlidingTuning {
  /** Sunlight warmth shift in [-1, 1]; 0 is the reference tropical sunlit aqua. */
  readonly sunWarmth: number;
  /** Sea-foam ribbon density multiplier in [0, 2]; 1 is the reference balance. */
  readonly foam: number;
}

export function glidingTuning(knobs: KnobValues): GlidingTuning {
  return {
    sunWarmth: knobValue(knobs, GLIDING_SUN_WARMTH_KNOB),
    foam: knobValue(knobs, GLIDING_FOAM_KNOB),
  };
}

export interface GlidingMotion {
  /** Cumulative world-space distance glided along the heading (world units). */
  readonly scroll: number;
  /** Cumulative organic evolution phase for swells, foam breakup and caustics. */
  readonly phase: number;
  /** Damped camera dolly offset in frame heights. */
  readonly dollyX: number;
  readonly dollyY: number;
}

/** Curated still pose shown under reduced motion. */
export const GLIDING_STILL: GlidingMotion = {
  scroll: 0,
  phase: 0,
  dollyX: 0,
  dollyY: 0,
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Advance the ocean glide and damped pointer dolly by `dt` seconds.
 * Exact exponential damping keeps the trajectory independent of frame rate.
 */
export function stepGlidingMotion(
  state: GlidingMotion,
  input: {
    readonly dt: number;
    readonly calm: number;
    readonly pointerNear: number;
    readonly pointerOffsetX: number;
    readonly pointerOffsetY: number;
  },
): GlidingMotion {
  const { dt, calm, pointerNear, pointerOffsetX, pointerOffsetY } = input;
  if (dt <= 0) return state;
  const pace = 1 - clamp(calm, 0, 1) * 0.45;
  const delta = dt * GLIDE_SPEED * pace;
  const near = clamp(pointerNear, 0, 1) * (1 - clamp(calm, 0, 1) * 0.7);
  const targetX = clamp(pointerOffsetX, -1, 1) * DOLLY_MAX.x * near;
  const targetY = clamp(pointerOffsetY, -1, 1) * DOLLY_MAX.y * near;
  const rate = near > 0.05 ? DOLLY_ATTACK : DOLLY_RELEASE;
  const share = 1 - Math.exp(-rate * dt);
  return {
    scroll: state.scroll + delta,
    phase: state.phase + delta * GLIDE_PHASE_RATIO,
    dollyX: state.dollyX + (targetX - state.dollyX) * share,
    dollyY: state.dollyY + (targetY - state.dollyY) * share,
  };
}
