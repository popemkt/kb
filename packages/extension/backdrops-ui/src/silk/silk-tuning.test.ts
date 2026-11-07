import { describe, expect, it } from "vitest";
import { MOVING_KNOBS, SILK_HUE_KNOB, SILK_IRIDESCENCE_KNOB, SILK_KNOBS } from "@kb/backdrops";
import { knobDefaults, knobSchemaError } from "@kb/model";
import { SILK_FILM_MIX, silkTuning } from "./silk-tuning";

describe("the Silk's knobs", () => {
  it("declare a schema a panel can draw", () => {
    expect(knobSchemaError([...MOVING_KNOBS, ...SILK_KNOBS])).toBeNull();
  });

  it("at their defaults dye and light the silk as it was before it had a knob", () => {
    for (const values of [{}, knobDefaults(SILK_KNOBS)])
      expect(silkTuning(values)).toEqual({ hue: 0, iridescence: 1 });
  });

  it("turn the dyes by the knob's degrees, either way", () => {
    expect(silkTuning({ [SILK_HUE_KNOB.id]: 90 }).hue).toBeCloseTo(Math.PI / 2);
    expect(silkTuning({ [SILK_HUE_KNOB.id]: -45 }).hue).toBeCloseTo(-Math.PI / 4);
  });

  it("play more or less of the film in the sheen, never past all of it", () => {
    expect(silkTuning({ [SILK_IRIDESCENCE_KNOB.id]: 0 }).iridescence).toBe(0);
    const most = silkTuning({ [SILK_IRIDESCENCE_KNOB.id]: SILK_IRIDESCENCE_KNOB.max }).iridescence;
    expect(most).toBeGreaterThan(1);
    // The film's share of the sheen, on either page, stays a share.
    for (const share of Object.values(SILK_FILM_MIX)) expect(share * most).toBeLessThanOrEqual(1);
  });
});
