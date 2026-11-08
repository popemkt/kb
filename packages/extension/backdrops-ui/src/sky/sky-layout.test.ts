import { describe, expect, it } from "vitest";
import { SKY_FLOCK_KNOB, SKY_GLOW_KNOB, SKY_MOTES_KNOB } from "@kb/backdrops";
import type { KnobValues } from "@kb/model";
import { flockSize, moteCount, skyLayout, type SkyFrame } from "./sky-layout";

const frame = (knobs: KnobValues = {}, over: Partial<SkyFrame> = {}): SkyFrame => ({
  width: 1000,
  height: 300,
  direction: "down",
  strength: "soft",
  quality: 1,
  palette: { dark: true },
  knobs,
  ...over,
});

describe("skyLayout", () => {
  it("at the knobs' defaults is the light as it was drawn before it had a knob", () => {
    expect(skyLayout(frame())).toEqual({
      x: 1000 * 0.63,
      y: 300 * 0.34,
      reach: Math.min(1000 * 0.52, 300 * 1.25),
      disc: 34,
      squash: 1,
      power: 4.2,
      intensity: 1,
      washFrom: "top",
    });
    expect(skyLayout(frame({}, { palette: { dark: false }, direction: "up" }))).toMatchObject({
      y: 300 * 0.66,
      disc: 38,
      washFrom: "bottom",
    });
  });

  it("grows and shrinks the moon and its glow with the glow knob, standing where it stood", () => {
    const base = skyLayout(frame());
    const big = skyLayout(frame({ [SKY_GLOW_KNOB.id]: SKY_GLOW_KNOB.max }));
    const small = skyLayout(frame({ [SKY_GLOW_KNOB.id]: SKY_GLOW_KNOB.min }));
    expect(big.reach).toBeCloseTo(base.reach * SKY_GLOW_KNOB.max);
    expect(big.disc).toBeCloseTo(base.disc * SKY_GLOW_KNOB.max);
    expect(small.reach).toBeCloseTo(base.reach * SKY_GLOW_KNOB.min);
    expect([big.x, big.y]).toEqual([base.x, base.y]);
  });
});

describe("flockSize", () => {
  it("at its default flies the strength's flock", () => {
    expect(flockSize(frame({}, { strength: "subtle" }))).toBe(4);
    expect(flockSize(frame())).toBe(6);
    expect(flockSize(frame({}, { strength: "vivid" }))).toBe(9);
    expect(flockSize(frame({}, { strength: "vivid", quality: 0.45 }))).toBe(4);
  });

  it("flies fewer with the flock knob, never more than its default flies and never fewer than three", () => {
    for (const strength of ["subtle", "soft", "vivid"] as const)
      expect(flockSize(frame({ [SKY_FLOCK_KNOB.id]: SKY_FLOCK_KNOB.max }, { strength }))).toBe(
        flockSize(frame({}, { strength })),
      );
    expect(flockSize(frame({ [SKY_FLOCK_KNOB.id]: 0.7 }))).toBe(4);
    expect(flockSize(frame({ [SKY_FLOCK_KNOB.id]: SKY_FLOCK_KNOB.min }))).toBe(3);
  });
});

describe("moteCount", () => {
  it("at its default scatters the strength's stars or dust", () => {
    expect(moteCount(frame())).toBe(22);
    expect(moteCount(frame({}, { strength: "vivid", quality: 0.7 }))).toBe(21);
  });

  it("scatters fewer with the motes knob, never more than its default, none at 0", () => {
    for (const strength of ["subtle", "soft", "vivid"] as const)
      expect(moteCount(frame({ [SKY_MOTES_KNOB.id]: SKY_MOTES_KNOB.max }, { strength }))).toBe(
        moteCount(frame({}, { strength })),
      );
    expect(moteCount(frame({ [SKY_MOTES_KNOB.id]: 0.5 }))).toBe(11);
    expect(moteCount(frame({ [SKY_MOTES_KNOB.id]: 0 }))).toBe(0);
  });
});
