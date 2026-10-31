import { describe, expect, it } from "vitest";
import { CIRCLE, ENGRAVING, EYES, GLYPHS, MASK, RUNES, tremble, type Point } from "./medallion";

/** Whether `at` is inside the closed polygon `points` (even–odd). */
function inside([x, y]: Point, points: readonly Point[]): boolean {
  let within = false;
  points.forEach(([ax, ay], i) => {
    const [bx, by] = points[(i + points.length - 1) % points.length] ?? [ax, ay];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) within = !within;
  });
  return within;
}

describe("the medallion", () => {
  it("is a mask symmetric about its middle, standing inside the rim", () => {
    for (const [x, y] of MASK) {
      expect(Math.hypot(x, y)).toBeLessThan(0.86);
      expect(MASK.some(([mx, my]) => Math.abs(mx + x) < 1e-9 && Math.abs(my - y) < 1e-9)).toBe(
        true,
      );
    }
  });

  it("cuts its eyes and its engraving into the mask, never off it", () => {
    for (const [from, to] of [...EYES, ...ENGRAVING]) {
      const middle: Point = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
      expect(inside(middle, MASK), `${from.join()} → ${to.join()}`).toBe(true);
    }
  });
});

describe("the circle of glyphs", () => {
  it("has five glyphs, each its own, each within its cell", () => {
    expect(GLYPHS.map((glyph) => glyph.evokes)).toEqual([
      "force",
      "flame",
      "ward",
      "shield",
      "mind",
    ]);
    for (const glyph of GLYPHS) {
      for (const [from, to] of glyph.strokes) {
        expect(Math.hypot(...from)).toBeLessThanOrEqual(1);
        expect(Math.hypot(...to)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("stands every glyph between the two rings, clear of the disk", () => {
    const reach = Math.max(
      ...GLYPHS.flatMap((glyph) =>
        glyph.strokes.flatMap(([a, b]) => [Math.hypot(...a), Math.hypot(...b)]),
      ),
    );
    expect(CIRCLE.glyphs - reach * CIRCLE.glyph).toBeGreaterThan(CIRCLE.inner);
    expect(CIRCLE.glyphs + reach * CIRCLE.glyph).toBeLessThan(CIRCLE.outer);
    expect(CIRCLE.inner).toBeGreaterThan(1);
  });
});

describe("the runes as glyph art", () => {
  it("are the glyphs, in order, each its own colour, drawn as strokes in its cell", () => {
    expect(RUNES.map((rune) => rune.name)).toEqual(GLYPHS.map((glyph) => glyph.evokes));
    const colours = RUNES.map((rune) => rune.color);
    expect(new Set(colours).size).toBe(GLYPHS.length);
    for (const [k, rune] of RUNES.entries()) {
      expect(rune.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(rune.shape.kind).toBe("path");
      if (rune.shape.kind !== "path") continue;
      expect(rune.shape.viewBox).toEqual([-1, -1, 2, 2]);
      expect(rune.shape.stroke).toBeGreaterThan(0);
      // Every stroke is in the path, y flipped as SVG's is.
      for (const [[ax, ay], [bx, by]] of GLYPHS[k]?.strokes ?? []) {
        expect(rune.shape.d).toContain(`M ${ax} ${-ay} L ${bx} ${-by}`);
      }
    }
  });
});

describe("tremble", () => {
  it("is still before anything happens and once it has rung, and shivers within its reach between", () => {
    expect(tremble(Infinity, 1)).toEqual([0, 0]);
    expect(tremble(-1, 1)).toEqual([0, 0]);
    expect(tremble(10, 1)).toEqual([0, 0]);
    let moved = 0;
    for (let t = 0; t < 3; t += 1 / 120) {
      const [x, y] = tremble(t, 1);
      expect(Math.hypot(x, y)).toBeLessThan(0.05);
      moved = Math.max(moved, Math.hypot(x, y));
    }
    expect(moved).toBeGreaterThan(0.01);
    expect(Math.hypot(...tremble(2.5, 1))).toBeLessThan(Math.hypot(...tremble(0.2, 1)) + 1e-3);
  });

  it("is as strong as what startled it", () => {
    const [x] = tremble(0.1, 0.5);
    const [full] = tremble(0.1, 1);
    expect(x).toBeCloseTo(full / 2, 9);
  });
});
