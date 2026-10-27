import { describe, expect, it } from "vitest";
import { FAR_CITY, NEAR_CITY, SKYLINE_H, SKYLINE_W, skylineLayer } from "./skyline";

/** How many numbers each path command takes, and which of them are y values. */
const ARGS: Record<string, { n: number; ys: readonly number[] }> = {
  M: { n: 2, ys: [1] },
  L: { n: 2, ys: [1] },
  H: { n: 1, ys: [] },
  V: { n: 1, ys: [0] },
  C: { n: 6, ys: [1, 3, 5] },
  Q: { n: 4, ys: [1, 3] },
  A: { n: 7, ys: [6] },
  Z: { n: 0, ys: [] },
};

/**
 * The highest point a path reaches (its smallest y): the y of every point
 * and control point, and for an arc its end lifted by its vertical radius,
 * since every arc here is a half ellipse spanning its tower or its ring.
 */
function highest(d: string): number {
  let top = Number.POSITIVE_INFINITY;
  for (const [, command, rest] of d.matchAll(/([MLHVCQAZ])([^MLHVCQAZ]*)/g)) {
    const spec = ARGS[command ?? ""];
    if (spec === undefined) throw new Error(`unexpected command ${command}`);
    const numbers = (rest ?? "").trim().split(/\s+/).filter(Boolean).map(Number);
    expect(numbers.length, `${command}${rest}`).toBe(spec.n);
    for (const index of spec.ys) {
      const y = numbers[index] ?? 0;
      top = Math.min(top, command === "A" ? y - (numbers[1] ?? 0) : y);
    }
  }
  return top;
}

describe("the skyline", () => {
  it("is the same city on every load", () => {
    expect(skylineLayer(7, [0.34, 0.62], [22, 54], 0)).toEqual(FAR_CITY);
    expect(skylineLayer(31, [0.16, 0.38], [34, 80], 0.07)).toEqual(NEAR_CITY);
  });

  it("keeps every crown inside the drawing, so no roof is cut flat by its top edge", () => {
    for (const layer of [FAR_CITY, NEAR_CITY]) {
      expect(highest(layer.d)).toBeGreaterThanOrEqual(0);
    }
  });

  it("stands on the ground across the whole width", () => {
    for (const layer of [FAR_CITY, NEAR_CITY]) {
      const xs = [...layer.d.matchAll(/M(-?[\d.]+) (\d+(?:\.\d+)?)/g)]
        .filter(([, , y]) => Number(y) === SKYLINE_H)
        .map(([, x]) => Number(x));
      expect(Math.min(...xs)).toBeLessThanOrEqual(0);
      expect(Math.max(...xs)).toBeGreaterThan(SKYLINE_W - 120);
    }
  });

  it("lights windows only in the near city, inside the drawing", () => {
    expect(FAR_CITY.windows).toHaveLength(0);
    expect(NEAR_CITY.windows.length).toBeGreaterThan(0);
    for (const window of NEAR_CITY.windows) {
      expect(window.y).toBeGreaterThan(0);
      expect(window.y + window.h).toBeLessThanOrEqual(SKYLINE_H);
    }
  });
});
