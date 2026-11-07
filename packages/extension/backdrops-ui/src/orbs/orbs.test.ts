import { describe, expect, it } from "vitest";
import { ORBS_GLOW_KNOB, ORBS_HUE_KNOB, ORBS_SIZE_KNOB } from "@kb/backdrops";
import { seededRng } from "../scene/rng";
import { ORBS, glowAt, layoutOrbs, litToward, orbsLook, placeOrbs, sizedOrbs } from "./orbs";

const AT = { x: 0.4, y: 0.05, scale: 1, lean: [0, 0] } as const;
const CENTRE = { x: 0, y: 0, scale: 1, lean: [0, 0] } as const;

describe("layoutOrbs", () => {
  it("is the seed's, and lays out exactly the orbs the shader reads", () => {
    for (let seed = 1; seed < 200; seed++) {
      const orbs = layoutOrbs(seededRng(seed));
      expect(orbs).toHaveLength(ORBS);
      for (const orb of orbs) {
        expect(orb.r).toBeGreaterThan(0);
        expect(orb.light).toBeGreaterThanOrEqual(0);
        expect(orb.light).toBeLessThanOrEqual(1);
      }
    }
    expect(layoutOrbs(seededRng(7))).toEqual(layoutOrbs(seededRng(7)));
    expect(layoutOrbs(seededRng(7))).not.toEqual(layoutOrbs(seededRng(8)));
  });

  it("keeps the reference composition: the great orb lit and largest, one orb in shadow", () => {
    const [great, ...rest] = layoutOrbs(seededRng(3));
    expect(great?.light).toBe(1);
    for (const orb of rest) expect(orb.r).toBeLessThan(great?.r ?? 0);
    expect(rest.filter((orb) => orb.light < 0.5)).toHaveLength(1);
  });
});

describe("placeOrbs", () => {
  const orbs = layoutOrbs(seededRng(11));

  it("drifts each orb within its reach of its rest for minutes on end", () => {
    for (let t = 0; t < 600; t += 3.7) {
      placeOrbs(orbs, t, AT, 0).forEach((placed, i) => {
        const orb = orbs[i];
        if (orb === undefined) throw new Error("an orb went missing");
        expect(Math.abs(placed.x - (AT.x + orb.x))).toBeLessThanOrEqual(orb.reach + 1e-9);
        expect(Math.abs(placed.y - (AT.y + orb.y))).toBeLessThanOrEqual(orb.reach * 0.7 + 1e-9);
        expect(placed.r / orb.r).toBeGreaterThan(0.94);
        expect(placed.r / orb.r).toBeLessThan(1.06);
      });
    }
  });

  it("keeps the two great orbs above the field, cut by the top: clear of the frame's bottom however the eye leans, and at rest inside a desktop frame's sides", () => {
    for (let seed = 1; seed < 60; seed++) {
      const all = layoutOrbs(seededRng(seed));
      for (const orb of placeOrbs(all, 0, CENTRE, 0).slice(0, 2)) {
        // A desktop frame (1280 wide) is about 2.9 heights across, the content at its centre.
        expect(Math.abs(orb.x) + orb.r).toBeLessThan(1.45);
      }
      for (let t = 0; t < 120; t += 2.3) {
        for (const lean of [-1, 1]) {
          const at = { ...CENTRE, lean: [lean, lean * 0.5] as const };
          const [great, second] = placeOrbs(all, t, at, 1);
          if (great === undefined || second === undefined) throw new Error("an orb went missing");
          for (const orb of [great, second]) {
            expect(orb.y - orb.r).toBeGreaterThan(-0.45);
            expect(orb.y + orb.r).toBeGreaterThan(0.5);
          }
          // The great one half again as wide as the frame is tall.
          expect(great.r * 2).toBeGreaterThan(1.35);
        }
      }
    }
  });

  it("slides the near orb further than the far one as the eye leans (parallax)", () => {
    const rest = placeOrbs(orbs, 0, CENTRE, 0);
    const leant = placeOrbs(orbs, 0, { ...CENTRE, lean: [0.5, 0] }, 0);
    const shift = (i: number) => (leant[i]?.x ?? 0) - (rest[i]?.x ?? 0);
    expect(shift(0)).toBeLessThan(0);
    expect(Math.abs(shift(0))).toBeGreaterThan(Math.abs(shift(ORBS - 1)));
  });

  it("scales the whole about the composition, and swells it with the owner's writes", () => {
    const half = { ...AT, scale: 0.5 };
    const [still] = placeOrbs(orbs, 0, half, 0);
    const [swollen] = placeOrbs(orbs, 0, half, 1);
    expect(still?.r).toBeCloseTo((orbs[0]?.r ?? 0) * 0.5, 1);
    expect(swollen?.r).toBeGreaterThan(still?.r ?? 0);
    expect(swollen?.x).toBe(still?.x);
  });
});

describe("litToward", () => {
  const [great, second] = placeOrbs(layoutOrbs(seededRng(5)), 0, CENTRE, 0);
  if (great === undefined || second === undefined) throw new Error("an orb went missing");

  it("lights the great orb on its upper right and the second on its lower right, as the reference does", () => {
    const lamp = { x: 0.9, y: 0.38 };
    const [gx, gy] = litToward(great, lamp);
    const [sx, sy] = litToward(second, lamp);
    expect(Math.hypot(gx, gy)).toBeCloseTo(1, 9);
    expect(gx).toBeGreaterThan(0);
    expect(gy).toBeGreaterThan(0);
    expect(sx).toBeGreaterThan(0);
    expect(sy).toBeLessThan(0);
  });

  it("swings an orb's lit side toward the lamp as it moves", () => {
    const [, low] = litToward(great, { x: great.x + 1, y: great.y - 0.5 });
    const [, high] = litToward(great, { x: great.x + 1, y: great.y + 0.5 });
    expect(high).toBeGreaterThan(low);
  });
});

describe("the owner's knobs", () => {
  it("at their defaults are the picture as it was: no hue past the load's, the orbs' own size, the glow at rest", () => {
    expect(orbsLook({})).toEqual({ hue: 0, size: 1, glow: 1 });
    const orbs = layoutOrbs(seededRng(4));
    expect(sizedOrbs(orbs, 1)).toEqual(orbs);
    for (const impulse of [0, 0.4, 1]) expect(glowAt(1, impulse)).toBe(1 + 0.6 * impulse);
  });

  it("turn the hue by the knob's degrees, either way", () => {
    expect(orbsLook({ hue: 30 }).hue).toBeCloseTo(Math.PI / 6, 9);
    expect(orbsLook({ hue: ORBS_HUE_KNOB.min }).hue).toBeLessThan(0);
  });

  it("shrink every orb and its glow alike, the great one still largest and still cut by the frame's top", () => {
    const size = ORBS_SIZE_KNOB.min;
    expect(orbsLook({ size }).size).toBe(size);
    for (let seed = 1; seed < 40; seed++) {
      const orbs = layoutOrbs(seededRng(seed));
      const small = sizedOrbs(orbs, size);
      small.forEach((orb, i) => {
        expect(orb.r).toBeCloseTo((orbs[i]?.r ?? 0) * size, 9);
        expect(orb.halo).toBeCloseTo((orbs[i]?.halo ?? 0) * size, 9);
        expect(orb.x).toBe(orbs[i]?.x);
      });
      for (let t = 0; t < 120; t += 2.3) {
        const [great, second] = placeOrbs(small, t, { x: 0, y: 0, scale: 1, lean: [1, 0.5] }, 1);
        if (great === undefined || second === undefined) throw new Error("an orb went missing");
        expect(great.r).toBeGreaterThan(second.r);
        for (const orb of [great, second]) {
          expect(orb.y - orb.r).toBeGreaterThan(-0.45);
          expect(orb.y + orb.r).toBeGreaterThan(0.5);
        }
      }
    }
  });

  it("brighten the glow with the knob, the owner's writes still lifting it", () => {
    expect(orbsLook({ glow: ORBS_GLOW_KNOB.max }).glow).toBe(ORBS_GLOW_KNOB.max);
    expect(glowAt(ORBS_GLOW_KNOB.max, 0)).toBeGreaterThan(glowAt(1, 0));
    expect(glowAt(ORBS_GLOW_KNOB.min, 0)).toBeLessThan(glowAt(1, 0));
    expect(glowAt(ORBS_GLOW_KNOB.min, 1)).toBeGreaterThan(glowAt(ORBS_GLOW_KNOB.min, 0));
  });
});
