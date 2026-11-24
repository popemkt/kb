import { describe, expect, it } from "vitest";
import { GLIDING_FOAM_KNOB, GLIDING_SUN_WARMTH_KNOB } from "@kb/backdrops";
import {
  DOLLY_MAX,
  GLIDE_PHASE_RATIO,
  GLIDE_SPEED,
  GLIDING_STILL,
  glidingTuning,
  stepGlidingMotion,
} from "./gliding-tuning";

describe("glidingTuning", () => {
  it("uses the knob defaults when no overrides are given", () => {
    expect(glidingTuning({})).toEqual({
      sunWarmth: GLIDING_SUN_WARMTH_KNOB.default,
      foam: GLIDING_FOAM_KNOB.default,
    });
  });

  it("maps sun warmth and foam knobs cleanly within their declared ranges", () => {
    expect(
      glidingTuning({
        [GLIDING_SUN_WARMTH_KNOB.id]: 0.65,
        [GLIDING_FOAM_KNOB.id]: 1.4,
      }),
    ).toEqual({ sunWarmth: 0.65, foam: 1.4 });
  });
});

function simulateGliding(stepMs: number) {
  let state = GLIDING_STILL;
  const steps = Math.round(1200 / stepMs);
  const dt = 1.2 / steps;
  for (let i = 0; i < steps; i++) {
    state = stepGlidingMotion(state, {
      dt,
      calm: 0,
      pointerNear: 1,
      pointerOffsetX: 0.8,
      pointerOffsetY: -0.5,
    });
  }
  return state;
}

describe("stepGlidingMotion", () => {
  it("holds still when dt is 0 (reduced motion)", () => {
    expect(
      stepGlidingMotion(GLIDING_STILL, {
        dt: 0,
        calm: 0,
        pointerNear: 1,
        pointerOffsetX: 1,
        pointerOffsetY: 1,
      }),
    ).toBe(GLIDING_STILL);
  });

  it("advances scroll and phase drift at the same trajectory for 8 ms and 33 ms steps", () => {
    const fast = simulateGliding(8);
    const slow = simulateGliding(33);
    expect(fast.scroll).toBeCloseTo(1.2 * GLIDE_SPEED, 5);
    expect(fast.phase).toBeCloseTo(fast.scroll * GLIDE_PHASE_RATIO, 5);
    expect(Math.abs(fast.scroll - slow.scroll)).toBeLessThan(1e-6);
    expect(Math.abs(fast.dollyX - slow.dollyX) / DOLLY_MAX.x).toBeLessThan(0.01);
    expect(Math.abs(fast.dollyY - slow.dollyY) / DOLLY_MAX.y).toBeLessThan(0.01);
  });

  it("eases pointer dolly gently, stays bounded, and settles to rest within 3 s of pointer leave", () => {
    // First 60 fps frame moves well under 20% of final displacement.
    const first = stepGlidingMotion(GLIDING_STILL, {
      dt: 1 / 60,
      calm: 0,
      pointerNear: 1,
      pointerOffsetX: 1,
      pointerOffsetY: 1,
    });
    expect(first.dollyX / DOLLY_MAX.x).toBeLessThan(0.2);

    // Sweeping far past frame bounds stays strictly within DOLLY_MAX.
    let state = first;
    for (let i = 0; i < 120; i++) {
      state = stepGlidingMotion(state, {
        dt: 1 / 60,
        calm: 0,
        pointerNear: 1,
        pointerOffsetX: 4,
        pointerOffsetY: -4,
      });
    }
    expect(Math.abs(state.dollyX)).toBeLessThanOrEqual(DOLLY_MAX.x);
    expect(Math.abs(state.dollyY)).toBeLessThanOrEqual(DOLLY_MAX.y);

    // Pointer leaves: settles smoothly back to rest within 3 s with no overshoot.
    for (let i = 0; i < 180; i++) {
      state = stepGlidingMotion(state, {
        dt: 1 / 60,
        calm: 0,
        pointerNear: 0,
        pointerOffsetX: 0,
        pointerOffsetY: 0,
      });
      expect(state.dollyX).toBeGreaterThanOrEqual(0);
      expect(state.dollyY).toBeLessThanOrEqual(0);
    }
    expect(Math.abs(state.dollyX)).toBeLessThan(DOLLY_MAX.x * 0.01);
    expect(Math.abs(state.dollyY)).toBeLessThan(DOLLY_MAX.y * 0.01);
  });
});
