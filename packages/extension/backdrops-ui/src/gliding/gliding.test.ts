import { describe, expect, it } from "vitest";
import { GLIDING_KNOB_MAP } from "@kb/backdrops";
import {
  DOLLY_MAX,
  FOAM_PHASE_RATIO,
  GLIDE_SPEED,
  GLIDING_STILL,
  SEABED_PHASE_RATIO,
  SWELL_PHASE_RATIO,
  glidingTuning,
  stepGlidingMotion,
} from "./gliding-tuning";

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
      seabedMotion: 1.5,
      swellMotion: 0.75,
      foamMotion: 1.8,
    });
  }
  return state;
}

describe("glidingTuning", () => {
  it("uses the knob defaults when no overrides are given", () => {
    const k = GLIDING_KNOB_MAP;
    expect(glidingTuning({})).toEqual({
      sunWarmth: k.sunWarmth.default,
      foam: k.foam.default,
      caustics: k.caustics.default,
      parallax: k.parallax.default,
      seabedMotion: k.seabedMotion.default,
      swellMotion: k.swellMotion.default,
      foamMotion: k.foamMotion.default,
      painterly: k.painterly.default,
      paperTexture: k.paperTexture.default,
      shadowBlend: k.shadowBlend.default,
      shadowDepth: k.shadowDepth.default,
      shadowSoftness: k.shadowSoftness.default,
      shadowSize: k.shadowSize.default,
      shadowAltitude: k.shadowAltitude.default,
      hullShadow: k.hullShadow.default,
      hullSheen: k.hullSheen.default,
      waveSheen: k.waveSheen.default,
      seaGleam: k.seaGleam.default,
      windTrails: k.windTrails.default,
      birds: k.birds.default,
    });
  });

  it("maps ocean, shadow, sheen, wind-trail and bird knobs cleanly", () => {
    const k = GLIDING_KNOB_MAP;
    const mapped = glidingTuning({
      [k.sunWarmth.id]: 0.65,
      [k.foam.id]: 1.4,
      [k.caustics.id]: 0.35,
      [k.parallax.id]: 1.6,
      [k.painterly.id]: 1.4,
      [k.paperTexture.id]: 0.85,
      [k.shadowBlend.id]: "ink",
      [k.shadowDepth.id]: 1.25,
      [k.shadowSoftness.id]: 1.5,
      [k.shadowSize.id]: 0.75,
      [k.shadowAltitude.id]: 1.2,
      [k.hullShadow.id]: 1.3,
      [k.hullSheen.id]: 1.6,
      [k.waveSheen.id]: 1.4,
      [k.seaGleam.id]: 0.8,
      [k.windTrails.id]: 1.1,
      [k.birds.id]: 1.5,
    });
    expect(mapped.sunWarmth).toBe(0.65);
    expect(mapped.caustics).toBe(0.35);
    expect(mapped.painterly).toBe(1.4);
    expect(mapped.paperTexture).toBe(0.85);
    expect(mapped.shadowBlend).toBe("ink");
    expect(mapped.shadowSize).toBe(0.75);
    expect(mapped.shadowDepth).toBe(1.25);
    expect(mapped.hullShadow).toBe(1.3);
    expect(mapped.hullSheen).toBe(1.6);
    expect(mapped.waveSheen).toBe(1.4);
    expect(mapped.birds).toBe(1.5);
  });
});

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

  it("advances scroll and all three layer phases identically at 8 ms and 33 ms steps", () => {
    const fast = simulateGliding(8);
    const slow = simulateGliding(33);
    expect(fast.scroll).toBeCloseTo(1.2 * GLIDE_SPEED, 5);
    expect(fast.seabedPhase).toBeCloseTo(fast.scroll * SEABED_PHASE_RATIO * 1.5, 5);
    expect(fast.swellPhase).toBeCloseTo(fast.scroll * SWELL_PHASE_RATIO * 0.75, 5);
    expect(fast.foamPhase).toBeCloseTo(fast.scroll * FOAM_PHASE_RATIO * 1.8, 5);
    expect(Math.abs(fast.scroll - slow.scroll)).toBeLessThan(1e-6);
    expect(Math.abs(fast.seabedPhase - slow.seabedPhase)).toBeLessThan(1e-6);
    expect(Math.abs(fast.swellPhase - slow.swellPhase)).toBeLessThan(1e-6);
    expect(Math.abs(fast.foamPhase - slow.foamPhase)).toBeLessThan(1e-6);
    expect(Math.abs(fast.dollyX - slow.dollyX) / DOLLY_MAX.x).toBeLessThan(0.01);
    expect(Math.abs(fast.dollyY - slow.dollyY) / DOLLY_MAX.y).toBeLessThan(0.01);
  });

  it("freezes any layer whose motion knob is set to 0 while others keep moving", () => {
    const stepped = stepGlidingMotion(GLIDING_STILL, {
      dt: 1,
      calm: 0,
      pointerNear: 0,
      pointerOffsetX: 0,
      pointerOffsetY: 0,
      seabedMotion: 0,
      swellMotion: 1,
      foamMotion: 2,
    });
    expect(stepped.seabedPhase).toBe(0);
    expect(stepped.swellPhase).toBeGreaterThan(0);
    expect(stepped.foamPhase).toBeGreaterThan(stepped.swellPhase);
  });

  it("has inertial spring momentum, overshoots gently on hover release, and settles within 3 s", () => {
    const first = stepGlidingMotion(GLIDING_STILL, {
      dt: 1 / 60,
      calm: 0,
      pointerNear: 1,
      pointerOffsetX: 1,
      pointerOffsetY: 1,
    });
    expect(first.dollyX / DOLLY_MAX.x).toBeLessThan(0.2);

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
    expect(Math.abs(state.dollyX)).toBeLessThanOrEqual(DOLLY_MAX.x * 1.25);
    expect(Math.abs(state.dollyY)).toBeLessThanOrEqual(DOLLY_MAX.y * 1.25);

    let minDollyX = state.dollyX;
    for (let i = 0; i < 180; i++) {
      state = stepGlidingMotion(state, {
        dt: 1 / 60,
        calm: 0,
        pointerNear: 0,
        pointerOffsetX: 0,
        pointerOffsetY: 0,
      });
      minDollyX = Math.min(minDollyX, state.dollyX);
    }
    // Underdamped spring gently overshoots past zero before settling smoothly to rest.
    expect(minDollyX).toBeLessThan(0);
    expect(Math.abs(state.dollyX)).toBeLessThan(DOLLY_MAX.x * 0.02);
    expect(Math.abs(state.dollyY)).toBeLessThan(DOLLY_MAX.y * 0.02);
  });
});
