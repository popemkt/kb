import { describe, expect, it } from "vitest";
import {
  BLACK_HOLE_KNOBS,
  BLACK_HOLE_TILT_KNOB,
  GARGANTUA_BEAMING_KNOB,
  GARGANTUA_HEAT_KNOB,
  GARGANTUA_KNOBS,
  MOVING_KNOBS,
  WARP_KNOBS,
  WARP_PULL_KNOB,
  WARP_STREAKS_KNOB,
} from "@kb/backdrops";
import { knobDefaults, knobSchemaError, type KnobValues } from "@kb/model";
import { startReactions } from "../scene/reactions";
import { holeDolly, type HoleView } from "./hole-rig";
import { WARP_HORIZON, gargantuaTuning, warpTuning } from "./hole-tuning";

const FRAME = { width: 1280, height: 360 };
const REST: HoleView = { inclination: 0.105, azimuth: 0 };

/** The dolly's views over 4 s of 60 fps with no pointer, its knobs `tuned` first where given. */
function views(tuned?: KnobValues): HoleView[] {
  const dolly = holeDolly(REST);
  if (tuned !== undefined) dolly.tune(tuned);
  const reactions = startReactions();
  return Array.from({ length: 240 }, () => {
    reactions.update(1 / 60);
    return dolly.follow(1 / 60, reactions, FRAME);
  });
}

describe("the Black hole's knobs", () => {
  it("declare a schema a panel can draw, with either look's own", () => {
    for (const own of [GARGANTUA_KNOBS, WARP_KNOBS])
      expect(knobSchemaError([...MOVING_KNOBS, ...BLACK_HOLE_KNOBS, ...own])).toBeNull();
  });
});

describe("the hole's tilt", () => {
  it("at its default leaves the camera where it was before it had a knob", () => {
    const before = views();
    expect(views({})).toEqual(before);
    expect(views(knobDefaults(BLACK_HOLE_KNOBS))).toEqual(before);
  });

  it("scales how far above the disk the camera looks down, never its swing", () => {
    const before = views();
    for (const tilt of [BLACK_HOLE_TILT_KNOB.min, BLACK_HOLE_TILT_KNOB.max]) {
      const tilted = views({ [BLACK_HOLE_TILT_KNOB.id]: tilt });
      tilted.forEach((view, i) => {
        const was = before[i];
        expect(view.inclination).toBeCloseTo((was?.inclination ?? 0) * tilt, 12);
        expect(view.azimuth).toBe(was?.azimuth);
        // Never edge on, never looking down on the disk from far above it.
        expect(view.inclination).toBeGreaterThan(0.05);
        expect(view.inclination).toBeLessThan(0.25);
      });
    }
  });
});

describe("Gargantua's knobs", () => {
  it("at their defaults beam and heat the gas as it was before it had a knob", () => {
    for (const values of [{}, knobDefaults(GARGANTUA_KNOBS)])
      expect(gargantuaTuning(values)).toEqual({ beaming: 0.75, heat: 1 });
  });

  it("move the beaming and the heat with their knobs", () => {
    expect(gargantuaTuning({ [GARGANTUA_BEAMING_KNOB.id]: 0 }).beaming).toBe(0);
    expect(gargantuaTuning({ [GARGANTUA_BEAMING_KNOB.id]: 1 }).beaming).toBe(1);
    expect(gargantuaTuning({ [GARGANTUA_HEAT_KNOB.id]: 1.6 }).heat).toBe(1.6);
    expect(gargantuaTuning({ [GARGANTUA_HEAT_KNOB.id]: 0.6 }).heat).toBe(0.6);
  });
});

describe("Warp's knobs", () => {
  it("at their defaults streak and pull as it did before it had a knob", () => {
    for (const values of [{}, knobDefaults(WARP_KNOBS)])
      expect(warpTuning(values)).toEqual({ streaks: 0.4, reach: 2 });
  });

  it("push the streaks harder or softer with their knob", () => {
    expect(warpTuning({ [WARP_STREAKS_KNOB.id]: 1.5 }).streaks).toBeCloseTo(0.6);
    expect(warpTuning({ [WARP_STREAKS_KNOB.id]: 0.5 }).streaks).toBeCloseTo(0.2);
  });

  it("carry the pull further out or nearer in, always beyond the horizon", () => {
    const far = warpTuning({ [WARP_PULL_KNOB.id]: WARP_PULL_KNOB.max }).reach;
    const near = warpTuning({ [WARP_PULL_KNOB.id]: WARP_PULL_KNOB.min }).reach;
    expect(far).toBeGreaterThan(2);
    expect(near).toBeLessThan(2);
    expect(near).toBeGreaterThan(WARP_HORIZON * 1.5);
  });
});
