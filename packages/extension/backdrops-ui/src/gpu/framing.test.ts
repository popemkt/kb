import { describe, expect, it } from "vitest";
import { framingAt, PANEL_WIDTH, WIDE_WIDTH, type Composition } from "./framing";

const panel: Composition = { x: 0.74, y: 0.22, scale: 0.6, presence: 0.5 };
const wide: Composition = { x: 0.6, y: 0.4, scale: 1, presence: 1 };

/** `actual` is `expected`, field by field, to float precision. */
function expectComposition(actual: Composition, expected: Composition): void {
  for (const key of ["x", "y", "scale", "presence"] as const) {
    expect(actual[key]).toBeCloseTo(expected[key], 9);
  }
}

describe("framingAt", () => {
  it("is the panel's composition at a side panel's width and below", () => {
    expectComposition(framingAt(PANEL_WIDTH, panel, wide), panel);
    expectComposition(framingAt(320, panel, wide), panel);
  });

  it("is the wide composition from a wide frame up", () => {
    expectComposition(framingAt(WIDE_WIDTH, panel, wide), wide);
    expectComposition(framingAt(1600, panel, wide), wide);
  });

  it("eases between them, never past either", () => {
    const middle = framingAt((PANEL_WIDTH + WIDE_WIDTH) / 2, panel, wide);
    expect(middle.scale).toBeGreaterThan(panel.scale);
    expect(middle.scale).toBeLessThan(wide.scale);
    expect(middle.presence).toBeCloseTo((panel.presence + wide.presence) / 2, 5);
  });
});
