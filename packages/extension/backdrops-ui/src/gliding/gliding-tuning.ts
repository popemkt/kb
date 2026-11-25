/**
 * Gliding's pure tuning and motion math (`gliding-scene.ts`, `gliding-shader.ts`):
 * maps knob values to shader/rig uniforms and steps the 3-layer ocean glide,
 * independent per-layer animation phases, and damped camera dolly in a strictly
 * frame-rate-independent way.
 */
import { GLIDING_KNOB_MAP } from "@kb/backdrops";
import { knobValue, type KnobValues } from "@kb/model";

/** Base world-space ocean glide speed (world units per second along the flight heading). */
export const GLIDE_SPEED = 0.24;
/** Base organic evolution rates per world unit glided for each depth plane. */
export const SEABED_PHASE_RATIO = 0.24;
export const SWELL_PHASE_RATIO = 0.22;
export const FOAM_PHASE_RATIO = 0.28;
/** Maximum camera dolly lean in frame heights (horizontal and vertical). */
export const DOLLY_MAX = { x: 0.075, y: 0.045 } as const;
/** Inertial spring parameters for hover dolly (underdamped for gentle spring settle at end of movement). */
const DOLLY_OMEGA_ATTACK = 4.4;
const DOLLY_OMEGA_RELEASE = 3.5;
const DOLLY_ZETA = 0.54;

export interface SpringResult {
  readonly value: number;
  readonly velocity: number;
}

export interface SpringStepInput {
  readonly value: number;
  readonly velocity: number;
  readonly target: number;
  readonly omega: number;
  readonly zeta: number;
  readonly dt: number;
}

/**
 * Exact closed-form analytical step of an underdamped 2nd-order spring (`zeta < 1`).
 * Compositional semigroup property keeps trajectories mathematically identical across
 * 30 fps, 60 fps, and 120 fps while delivering physical inertia and spring overshoot.
 */
export function stepSpring({
  value,
  velocity,
  target,
  omega,
  zeta,
  dt,
}: SpringStepInput): SpringResult {
  if (dt <= 0) return { value, velocity };
  const z = Math.min(0.98, Math.max(0.05, zeta));
  const wd = omega * Math.sqrt(1 - z * z);
  const decay = Math.exp(-z * omega * dt);
  const cosT = Math.cos(wd * dt);
  const sinT = Math.sin(wd * dt);
  const e0 = value - target;
  const b = (velocity + z * omega * e0) / wd;
  const e1 = decay * (e0 * cosT + b * sinT);
  const v1 = decay * ((b * wd - e0 * z * omega) * cosT - (e0 * wd + b * z * omega) * sinT);
  return { value: target + e1, velocity: v1 };
}

export type ShadowBlendMode = "multiply" | "ink" | "normal" | "burn";

export interface GlidingTuning {
  readonly sunWarmth: number;
  readonly foam: number;
  readonly caustics: number;
  readonly parallax: number;
  readonly seabedMotion: number;
  readonly swellMotion: number;
  readonly foamMotion: number;
  readonly painterly: number;
  readonly paperTexture: number;
  readonly shadowBlend: ShadowBlendMode;
  readonly shadowDepth: number;
  readonly shadowSoftness: number;
  readonly shadowSize: number;
  readonly shadowAltitude: number;
  readonly hullShadow: number;
  readonly hullSheen: number;
  readonly waveSheen: number;
  readonly seaGleam: number;
  readonly windTrails: number;
  readonly birds: number;
}

const parseShadowBlend = (value: string): ShadowBlendMode =>
  value === "normal" || value === "ink" || value === "burn" ? value : "multiply";

export function glidingTuning(knobs: KnobValues): GlidingTuning {
  const k = GLIDING_KNOB_MAP;
  return {
    sunWarmth: knobValue(knobs, k.sunWarmth),
    foam: knobValue(knobs, k.foam),
    caustics: knobValue(knobs, k.caustics),
    parallax: knobValue(knobs, k.parallax),
    seabedMotion: knobValue(knobs, k.seabedMotion),
    swellMotion: knobValue(knobs, k.swellMotion),
    foamMotion: knobValue(knobs, k.foamMotion),
    painterly: knobValue(knobs, k.painterly),
    paperTexture: knobValue(knobs, k.paperTexture),
    shadowBlend: parseShadowBlend(knobValue(knobs, k.shadowBlend)),
    shadowDepth: knobValue(knobs, k.shadowDepth),
    shadowSoftness: knobValue(knobs, k.shadowSoftness),
    shadowSize: knobValue(knobs, k.shadowSize),
    shadowAltitude: knobValue(knobs, k.shadowAltitude),
    hullShadow: knobValue(knobs, k.hullShadow),
    hullSheen: knobValue(knobs, k.hullSheen),
    waveSheen: knobValue(knobs, k.waveSheen),
    seaGleam: knobValue(knobs, k.seaGleam),
    windTrails: knobValue(knobs, k.windTrails),
    birds: knobValue(knobs, k.birds),
  };
}

export interface GlidingMotion {
  readonly time: number;
  readonly scroll: number;
  readonly seabedPhase: number;
  readonly swellPhase: number;
  readonly foamPhase: number;
  readonly dollyX: number;
  readonly dollyY: number;
  readonly dollyVelX: number;
  readonly dollyVelY: number;
}

/** Curated still pose shown under reduced motion. */
export const GLIDING_STILL: GlidingMotion = {
  time: 0,
  scroll: 0,
  seabedPhase: 0,
  swellPhase: 0,
  foamPhase: 0,
  dollyX: 0,
  dollyY: 0,
  dollyVelX: 0,
  dollyVelY: 0,
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Advance the 3-layer ocean glide, per-layer animation phases, and inertial spring
 * pointer dolly by `dt` seconds. Exact analytical spring math keeps trajectories
 * identical across 30 fps and 120 fps while adding airy inertia and end-of-move spring.
 */
export function stepGlidingMotion(
  state: GlidingMotion,
  input: {
    readonly dt: number;
    readonly calm: number;
    readonly pointerNear: number;
    readonly pointerOffsetX: number;
    readonly pointerOffsetY: number;
    readonly seabedMotion?: number;
    readonly swellMotion?: number;
    readonly foamMotion?: number;
  },
): GlidingMotion {
  const { dt, calm, pointerNear, pointerOffsetX, pointerOffsetY } = input;
  if (dt <= 0) return state;
  const pace = 1 - clamp(calm, 0, 1) * 0.45;
  const delta = dt * GLIDE_SPEED * pace;
  const seabedRate = clamp(input.seabedMotion ?? 1, 0, 2);
  const swellRate = clamp(input.swellMotion ?? 1, 0, 2);
  const foamRate = clamp(input.foamMotion ?? 1, 0, 2);
  const near = clamp(pointerNear, 0, 1) * (1 - clamp(calm, 0, 1) * 0.7);
  const targetX = clamp(pointerOffsetX, -1, 1) * DOLLY_MAX.x * near;
  const targetY = clamp(pointerOffsetY, -1, 1) * DOLLY_MAX.y * near;
  const omega = near > 0.05 ? DOLLY_OMEGA_ATTACK : DOLLY_OMEGA_RELEASE;
  const sx = stepSpring({
    value: state.dollyX,
    velocity: state.dollyVelX,
    target: targetX,
    omega,
    zeta: DOLLY_ZETA,
    dt,
  });
  const sy = stepSpring({
    value: state.dollyY,
    velocity: state.dollyVelY,
    target: targetY,
    omega,
    zeta: DOLLY_ZETA,
    dt,
  });
  return {
    time: state.time + dt * pace,
    scroll: state.scroll + delta,
    seabedPhase: state.seabedPhase + delta * SEABED_PHASE_RATIO * seabedRate,
    swellPhase: state.swellPhase + delta * SWELL_PHASE_RATIO * swellRate,
    foamPhase: state.foamPhase + delta * FOAM_PHASE_RATIO * foamRate,
    dollyX: clamp(sx.value, -DOLLY_MAX.x * 1.25, DOLLY_MAX.x * 1.25),
    dollyY: clamp(sy.value, -DOLLY_MAX.y * 1.25, DOLLY_MAX.y * 1.25),
    dollyVelX: sx.velocity,
    dollyVelY: sy.velocity,
  };
}
