import { describe, expect, it } from "vitest";
import { SEED_KNOB, SKY_FLOCK_KNOB, SPEED_KNOB } from "@kb/backdrops";
import { paletteOf, type SceneTokens } from "./palette";
import { compositionKnobs, sameLook, type Look } from "./look";

const TOKENS: SceneTokens = {
  background: { r: 20, g: 20, b: 22 },
  foreground: { r: 245, g: 245, b: 245 },
  primary: { r: 240, g: 170, b: 60 },
  sun: { r: 247, g: 201, b: 72 },
};

const look = (over: Partial<Look> = {}): Look => ({
  palette: paletteOf(TOKENS, null, true),
  direction: "down",
  strength: "soft",
  presence: 1,
  knobs: {},
  ...over,
});

describe("compositionKnobs", () => {
  it("leaves the composition what the stage does not implement itself: no speed, no seed", () => {
    const values = { [SPEED_KNOB.id]: 2, [SEED_KNOB.id]: 42, [SKY_FLOCK_KNOB.id]: 1.3 };
    expect(compositionKnobs(values)).toEqual({ [SKY_FLOCK_KNOB.id]: 1.3 });
  });
});

describe("sameLook", () => {
  it("is the same look for an equal palette made afresh and equal knobs held in another object", () => {
    const a = look({ knobs: { flock: 1.2 } });
    expect(sameLook(a, look({ knobs: { flock: 1.2 } }))).toBe(true);
  });

  it("is another look when a knob, a colour or the strength moves, and for none before it", () => {
    const a = look({ knobs: { flock: 1.2 } });
    expect(sameLook(null, a)).toBe(false);
    expect(sameLook(a, look({ knobs: { flock: 1.3 } }))).toBe(false);
    expect(sameLook(a, look({ knobs: {} }))).toBe(false);
    expect(sameLook(a, look({ knobs: { flock: 1.2 }, strength: "vivid" }))).toBe(false);
    const day = paletteOf({ ...TOKENS, background: { r: 250, g: 250, b: 250 } }, null, false);
    expect(sameLook(a, look({ knobs: { flock: 1.2 }, palette: day }))).toBe(false);
  });
});
