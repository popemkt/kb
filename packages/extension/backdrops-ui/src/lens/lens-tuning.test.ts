import { describe, expect, it } from "vitest";
import {
  LENS_HUE_KNOB,
  LENS_KNOBS,
  LENS_MASS_KNOB,
  LENS_STARS_KNOB,
  MOVING_KNOBS,
} from "@kb/backdrops";
import { knobDefaults, knobSchemaError } from "@kb/model";
import { lensTuning } from "./lens-tuning";

const PALETTE = [
  [0.55, 0.32, 1.0],
  [1.0, 0.36, 0.22],
  [0.2, 0.85, 0.85],
] as const;

describe("the Lens's knobs", () => {
  it("declare a schema a panel can draw", () => {
    expect(knobSchemaError([...MOVING_KNOBS, ...LENS_KNOBS])).toBeNull();
  });

  it("at their defaults draw the scene as it was drawn before it had a knob", () => {
    for (const values of [{}, knobDefaults(LENS_KNOBS)]) {
      const tuned = lensTuning(values);
      expect(tuned.einstein).toBe(0.15);
      for (const rgb of PALETTE) expect(tuned.dye(rgb)).toEqual([...rgb]);
      for (const drawn of [0.93, 0.945, 0.96]) expect(tuned.starCut(drawn)).toBe(drawn);
    }
  });

  it("make the star heavier or lighter with its mass", () => {
    const heavy = lensTuning({ [LENS_MASS_KNOB.id]: LENS_MASS_KNOB.max }).einstein;
    const light = lensTuning({ [LENS_MASS_KNOB.id]: LENS_MASS_KNOB.min }).einstein;
    expect(heavy).toBeCloseTo(0.15 * LENS_MASS_KNOB.max);
    expect(light).toBeCloseTo(0.15 * LENS_MASS_KNOB.min);
  });

  it("turn the nebula's dyes round the wheel, never below black", () => {
    const [r, g, b] = lensTuning({ [LENS_HUE_KNOB.id]: 120 }).dye([1, 0, 0]);
    expect(r).toBeCloseTo(0);
    expect(g).toBeCloseTo(1);
    expect(b).toBeCloseTo(0);
    for (let hue = LENS_HUE_KNOB.min; hue <= LENS_HUE_KNOB.max; hue += LENS_HUE_KNOB.step) {
      const dye = lensTuning({ [LENS_HUE_KNOB.id]: hue }).dye;
      for (const rgb of PALETTE) for (const c of dye(rgb)) expect(c).toBeGreaterThanOrEqual(0);
    }
  });

  it("show more stars as the knob rises and fewer as it falls, every cut a share of cells", () => {
    const drawn = 0.94;
    const more = lensTuning({ [LENS_STARS_KNOB.id]: LENS_STARS_KNOB.max }).starCut(drawn);
    const fewer = lensTuning({ [LENS_STARS_KNOB.id]: LENS_STARS_KNOB.min }).starCut(drawn);
    expect(more).toBeLessThan(drawn);
    expect(fewer).toBeGreaterThan(drawn);
    // Twice the stars: twice the share of cells that hold one.
    expect(1 - more).toBeCloseTo(2 * (1 - drawn));
    for (const cut of [more, fewer]) {
      expect(cut).toBeGreaterThan(0.8);
      expect(cut).toBeLessThan(1);
    }
  });
});
