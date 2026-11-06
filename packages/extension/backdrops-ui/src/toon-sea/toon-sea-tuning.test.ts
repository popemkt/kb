import { describe, expect, it } from "vitest";
import {
  MOVING_KNOBS,
  TOON_SEA_CLOUDS_KNOB,
  TOON_SEA_FOAM_KNOB,
  TOON_SEA_KNOBS,
  TOON_SEA_WAVES_KNOB,
} from "@kb/backdrops";
import { knobDefaults, knobSchemaError } from "@kb/model";
import { toonSeaTuning } from "./toon-sea-tuning";

describe("the Toon sea's knobs", () => {
  it("declare a schema a panel can draw", () => {
    expect(knobSchemaError([...MOVING_KNOBS, ...TOON_SEA_KNOBS])).toBeNull();
  });

  it("at their defaults draw the sea as it was drawn before it had a knob", () => {
    for (const values of [{}, knobDefaults(TOON_SEA_KNOBS)])
      expect(toonSeaTuning(values)).toEqual({ swell: 1, clouds: 1, foam: 0 });
  });

  it("raise and lower the swell and the cloud bank with their knobs", () => {
    expect(toonSeaTuning({ [TOON_SEA_WAVES_KNOB.id]: 1.6 }).swell).toBe(1.6);
    expect(toonSeaTuning({ [TOON_SEA_WAVES_KNOB.id]: 0.4 }).swell).toBe(0.4);
    expect(toonSeaTuning({ [TOON_SEA_CLOUDS_KNOB.id]: 1.3 }).clouds).toBe(1.3);
    expect(toonSeaTuning({ [TOON_SEA_CLOUDS_KNOB.id]: 0.5 }).clouds).toBe(0.5);
  });

  it("break more foam as its knob rises: the caps' threshold falls, a little either way", () => {
    const most = toonSeaTuning({ [TOON_SEA_FOAM_KNOB.id]: TOON_SEA_FOAM_KNOB.max }).foam;
    const least = toonSeaTuning({ [TOON_SEA_FOAM_KNOB.id]: TOON_SEA_FOAM_KNOB.min }).foam;
    expect(most).toBeLessThan(0);
    expect(least).toBeGreaterThan(0);
    expect(Math.abs(most)).toBeLessThanOrEqual(0.06);
    expect(Math.abs(least)).toBeLessThanOrEqual(0.06);
  });
});
