import { describe, expect, it } from "vitest";
import { AIRCRAFT_STILL, BANK_MAX, stepAircraftFlight } from "./aircraft-rig";

function simulateFlight(stepMs: number) {
  let state = AIRCRAFT_STILL;
  const steps = Math.round(1200 / stepMs);
  const dt = 1.2 / steps;
  for (let i = 0; i < steps; i++) {
    state = stepAircraftFlight(state, {
      dt,
      time: (i + 1) * dt,
      calm: 0,
      pointerOffsetX: 0.75,
      pointerOffsetY: -0.45,
      pointerNear: 1,
    });
  }
  return state;
}

describe("stepAircraftFlight", () => {
  it("holds the curated still pose when dt is 0", () => {
    expect(
      stepAircraftFlight(AIRCRAFT_STILL, {
        dt: 0,
        time: 5,
        calm: 0,
        pointerOffsetX: 1,
        pointerOffsetY: 1,
        pointerNear: 1,
      }),
    ).toBe(AIRCRAFT_STILL);
  });

  it("matches banking trajectory within 2% between 8 ms and 33 ms frame steps", () => {
    const fast = simulateFlight(8);
    const slow = simulateFlight(33);
    expect(Math.abs(fast.bankRoll - slow.bankRoll) / BANK_MAX.roll).toBeLessThan(0.02);
    expect(Math.abs(fast.bankPitch - slow.bankPitch) / BANK_MAX.pitch).toBeLessThan(0.02);
  });

  it("keeps pointer banking bounded and settles back toward calm glide when pointer leaves", () => {
    let state = AIRCRAFT_STILL;
    for (let i = 0; i < 120; i++) {
      state = stepAircraftFlight(state, {
        dt: 1 / 60,
        time: 0,
        calm: 0,
        pointerOffsetX: 3,
        pointerOffsetY: 3,
        pointerNear: 1,
      });
    }
    expect(Math.abs(state.bankRoll)).toBeLessThanOrEqual(BANK_MAX.roll + 0.06);
    expect(Math.abs(state.bankPitch)).toBeLessThanOrEqual(BANK_MAX.pitch + 0.04);

    let maxRoll = state.bankRoll;
    for (let i = 0; i < 180; i++) {
      state = stepAircraftFlight(state, {
        dt: 1 / 60,
        time: 0,
        calm: 1,
        pointerOffsetX: 0,
        pointerOffsetY: 0,
        pointerNear: 0,
      });
      maxRoll = Math.max(maxRoll, state.bankRoll);
    }
    // Inertial aerodynamic spring gently overshoots past zero before settling to level wings.
    expect(maxRoll).toBeGreaterThan(0);
    expect(Math.abs(state.bankRoll)).toBeLessThan(0.02);
    expect(Math.abs(state.bankPitch)).toBeLessThan(0.02);
  });
});
