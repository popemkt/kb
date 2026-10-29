import { describe, expect, it } from "vitest";
import { fillingReach, reachWithin } from "./dissolve";

describe("reachWithin", () => {
  it("keeps the reach asked for where the frame has room", () => {
    expect(reachWithin(3, { x: 0.3, y: 0 }, { x: 0.8, y: 0.3 }, 0.4)).toEqual({
      x: 0.3,
      y: 0,
      rx: 0.8,
      ry: 0.3,
      solid: 0.4,
    });
  });

  it("slides the reach inward before it cuts it, and always clears every side", () => {
    for (const aspect of [0.8, 1.6, 2.4, 4]) {
      for (const centre of [
        { x: aspect * 0.3, y: 0.1 },
        { x: -aspect * 0.45, y: -0.4 },
      ]) {
        const reach = reachWithin(aspect, centre, { x: 1.2, y: 0.6 }, 0.4);
        expect(reach.x + reach.rx).toBeLessThan(aspect / 2);
        expect(reach.x - reach.rx).toBeGreaterThan(-aspect / 2);
        expect(reach.y + reach.ry).toBeLessThan(0.5);
        expect(reach.y - reach.ry).toBeGreaterThan(-0.5);
      }
    }
    // Room enough across, so it slides rather than shrinks.
    expect(reachWithin(4, { x: 1.6, y: 0 }, { x: 1, y: 0.2 }, 0.4).rx).toBe(1);
  });
});

describe("fillingReach", () => {
  it("clears the sides and the bottom the page shows, and runs on past the top under the bar", () => {
    for (const aspect of [0.9, 2, 3.2]) {
      const reach = fillingReach(aspect, 0.7);
      expect(reach.x + reach.rx).toBeLessThan(aspect / 2);
      expect(reach.x - reach.rx).toBeGreaterThan(-aspect / 2);
      expect(reach.y - reach.ry).toBeGreaterThan(-0.5);
      expect(reach.y + reach.ry).toBeGreaterThan(1);
      // Its sides reach nearly to the frame's: the field fills it, not an oval in it.
      expect(reach.rx).toBeGreaterThan(aspect / 2 - 0.05);
    }
  });
});
