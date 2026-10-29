import { describe, expect, it } from "vitest";
import { seededRng } from "../scene/rng";
import { ORBS, layoutOrbs, placeOrbs } from "./orbs";

const AT = { x: 0.4, y: 0.05, scale: 1 };

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

  it("keeps every orb whole inside a frame centred on it: only its own edge ever cuts it", () => {
    for (let seed = 1; seed < 60; seed++) {
      const all = layoutOrbs(seededRng(seed));
      for (let t = 0; t < 120; t += 2.3) {
        for (const placed of placeOrbs(all, t, { x: 0, y: 0, scale: 1 }, 0)) {
          expect(Math.abs(placed.y) + placed.r).toBeLessThan(0.5);
        }
      }
    }
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
