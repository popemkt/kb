import { describe, expect, it } from "vitest";
import { anchorIn, framingAt, PANEL_WIDTH, WIDE_WIDTH, type Composition } from "./framing";

const panel: Composition = { x: 0.28, y: 0.22, scale: 0.6, presence: 0.5 };
const wide: Composition = { x: 0.2, y: 0.4, scale: 1, presence: 1 };

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

describe("anchorIn", () => {
  it("places the hero from the content's centre in heights, so a wider frame leaves it where it was", () => {
    const content = { left: 0, width: 720 };
    const narrow = anchorIn(wide, { width: 720, height: 360 }, content);
    // The same content in a frame twice as wide, centred on it: the hero is no farther from the content.
    const wider = anchorIn(wide, { width: 1440, height: 360 }, { left: 360, width: 720 });
    expect(narrow.x).toBeCloseTo(0.2, 9);
    expect(narrow.y).toBeCloseTo(0.1, 9);
    expect(narrow.scale).toBe(1);
    expect(wider.x).toBeCloseTo(narrow.x, 9);
    expect(wider.y).toBe(narrow.y);
  });

  it("follows content that stands off the frame's centre", () => {
    const anchor = anchorIn(wide, { width: 1440, height: 360 }, { left: 0, width: 720 });
    expect(anchor.x).toBeCloseTo(-1 + 0.2, 9);
  });
});
