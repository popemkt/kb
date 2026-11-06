import { describe, expect, it } from "vitest";
import { sceneClock } from "./clock";

describe("a scene's clock at the owner's speed (the speed knob)", () => {
  it("passes the frame's time at speed 1, and scales it at another", () => {
    const clock = sceneClock();
    expect(clock.advance(0.016)).toBeCloseTo(0.016);
    clock.setSpeed(2);
    expect(clock.advance(0.016)).toBeCloseTo(0.032);
    expect(clock.elapsed()).toBeCloseTo(0.048);
  });

  it("holds still at speed 0, and never runs back", () => {
    const clock = sceneClock();
    clock.advance(0.5);
    clock.setSpeed(0);
    expect(clock.advance(0.016)).toBe(0);
    clock.setSpeed(-3);
    expect(clock.advance(0.016)).toBe(0);
    expect(clock.elapsed()).toBeCloseTo(0.5);
  });

  it("starts from the speed it is given", () => {
    const clock = sceneClock(0.5);
    expect(clock.advance(0.1)).toBeCloseTo(0.05);
  });
});
