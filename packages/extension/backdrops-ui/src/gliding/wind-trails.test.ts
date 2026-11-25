import { describe, expect, it } from "vitest";
import { evaluateWindTrailIntensity } from "./wind-trails";

describe("evaluateWindTrailIntensity", () => {
  it("stays completely off under reduced motion or zero gain (no stray white strip)", () => {
    const still = evaluateWindTrailIntensity({
      time: 12,
      bankRoll: -0.1,
      bankPitch: 0.05,
      speedFactor: 1.5,
      gain: 1,
      reducedMotion: true,
    });
    expect(still).toEqual({ left: 0, right: 0, curl: 0 });

    const off = evaluateWindTrailIntensity({
      time: 12,
      bankRoll: -0.1,
      bankPitch: 0.05,
      speedFactor: 1.8,
      gain: 0,
      reducedMotion: false,
    });
    expect(off).toEqual({ left: 0, right: 0, curl: 0 });
  });

  it("activates asymmetrically when banking steeply and on both wingtips when speeding up", () => {
    const bankPort = evaluateWindTrailIntensity({
      time: 1.5,
      bankRoll: -0.11,
      bankPitch: 0,
      speedFactor: 1,
      gain: 1,
      reducedMotion: false,
    });
    expect(bankPort.left).toBeGreaterThan(bankPort.right);

    const fast = evaluateWindTrailIntensity({
      time: 1.5,
      bankRoll: 0,
      bankPitch: 0,
      speedFactor: 1.9,
      gain: 1,
      reducedMotion: false,
    });
    expect(fast.left).toBeGreaterThan(0.5);
    expect(fast.right).toBeGreaterThan(0.5);
  });
});
