import { describe, expect, it } from "vitest";
import { seededRng } from "../scene/rng";
import { STRANDS, bundle, layoutTrails, spread, strandAt } from "./trails";

describe("layoutTrails", () => {
  it("is the seed's, and lays out exactly the strands the shader reads", () => {
    for (let seed = 1; seed < 200; seed++) {
      const strands = layoutTrails(seededRng(seed));
      expect(strands).toHaveLength(STRANDS);
      for (const strand of strands) {
        expect(strand.depth).toBeGreaterThanOrEqual(0);
        expect(strand.depth).toBeLessThanOrEqual(1);
        expect(strand.warm).toBeGreaterThanOrEqual(0);
        expect(strand.warm).toBeLessThanOrEqual(1);
        expect(strand.width).toBeGreaterThan(0);
      }
    }
    expect(layoutTrails(seededRng(7))).toEqual(layoutTrails(seededRng(7)));
    expect(layoutTrails(seededRng(7))).not.toEqual(layoutTrails(seededRng(8)));
  });

  it("keeps the reference's bundle: sharp strands through the knot, some gold, and far sheens", () => {
    const strands = layoutTrails(seededRng(3));
    const near = strands.filter((s) => s.depth < 0.2);
    expect(near.length).toBeGreaterThan(5);
    for (const s of near) expect(Math.abs(s.offset)).toBeLessThan(0.05);
    expect(near.some((s) => s.warm > 0.8)).toBe(true);
    expect(strands.filter((s) => s.depth > 0.8).length).toBeGreaterThan(2);
  });
});

describe("the curve", () => {
  const strands = layoutTrails(seededRng(11));

  it("gathers the near strands at the knot and fans them out away from it", () => {
    const near = strands.filter((s) => s.depth < 0.2);
    const width = (u: number) => {
      const ys = near.map((s) => strandAt(s, u, 0) - bundle(u));
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(width(3)).toBeGreaterThan(width(0) * 2);
    expect(width(-3)).toBeGreaterThan(width(0) * 2);
  });

  it("falls to the right, so the bundle crosses the head from the upper left", () => {
    expect(bundle(-2)).toBeGreaterThan(bundle(0));
    expect(bundle(2)).toBeLessThan(bundle(0));
    expect(spread(0)).toBe(0);
    expect(spread(10)).toBeCloseTo(1, 5);
  });

  it("sways only a little, for minutes on end", () => {
    for (const strand of strands) {
      for (let t = 0; t < 600; t += 7.3) {
        const moved = Math.abs(strandAt(strand, 0.5, t) - strandAt(strand, 0.5, 0));
        expect(moved).toBeLessThanOrEqual(2 * strand.wave[0] + 1e-9);
      }
    }
  });
});
