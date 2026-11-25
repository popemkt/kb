import { describe, expect, it } from "vitest";
import {
  BASE_ENDURANCE_SECONDS,
  BASE_FUEL_FRACTION,
  evaluateFuelFraction,
  formatEnduranceClock,
} from "./endurance-hud";

describe("endurance-hud", () => {
  it("formats the reference endurance clock and advances cleanly across minute and hour boundaries", () => {
    expect(formatEnduranceClock(BASE_ENDURANCE_SECONDS)).toBe("31:31:22");
    expect(formatEnduranceClock(BASE_ENDURANCE_SECONDS + 38)).toBe("31:32:00");
    expect(formatEnduranceClock(BASE_ENDURANCE_SECONDS + 1718)).toBe("32:00:00");
    expect(formatEnduranceClock(-5)).toBe("00:00:00");
  });

  it("decreases fuel gently over long endurance flight and respects the reserve floor", () => {
    expect(evaluateFuelFraction(0)).toBeCloseTo(BASE_FUEL_FRACTION, 5);
    expect(evaluateFuelFraction(3600)).toBeLessThan(BASE_FUEL_FRACTION);
    expect(evaluateFuelFraction(1_000_000)).toBeCloseTo(0.14, 5);
  });
});
