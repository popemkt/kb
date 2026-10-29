import { describe, expect, it } from "vitest";
import { keptAt, reachWithin } from "./dissolve";

describe("reachWithin", () => {
  it("keeps the reach asked for where the frame has room", () => {
    expect(reachWithin(3, { x: 0.3, y: 0 }, { x: 0.8, y: 0.3 })).toEqual({
      x: 0.3,
      y: 0,
      rx: 0.8,
      ry: 0.3,
    });
  });

  it("slides the reach inward before it cuts it, and always clears every side", () => {
    for (const aspect of [0.8, 1.6, 2.4, 4]) {
      for (const centre of [
        { x: aspect * 0.3, y: 0.1 },
        { x: -aspect * 0.45, y: -0.4 },
      ]) {
        const reach = reachWithin(aspect, centre, { x: 1.2, y: 0.6 });
        expect(reach.x + reach.rx).toBeLessThan(aspect / 2);
        expect(reach.x - reach.rx).toBeGreaterThan(-aspect / 2);
        expect(reach.y + reach.ry).toBeLessThan(0.5);
        expect(reach.y - reach.ry).toBeGreaterThan(-0.5);
      }
    }
    // Room enough across, so it slides rather than shrinks.
    expect(reachWithin(4, { x: 1.6, y: 0 }, { x: 1, y: 0.2 }).rx).toBe(1);
  });
});

describe("keptAt", () => {
  const reach = { x: 0.2, y: 0, rx: 1, ry: 0.4 };
  it("keeps what stands well inside, and nothing past the rim", () => {
    expect(keptAt(reach, 0.2, 0)).toBe(1);
    expect(keptAt(reach, 0.6, 0.1)).toBe(1);
    expect(keptAt(reach, 1.3, 0)).toBe(0);
    expect(keptAt(reach, 0.2, 0.45)).toBe(0);
  });

  it("fades as a thing nears the rim, never rising again", () => {
    const along = [0.7, 0.8, 0.9, 1.0, 1.1].map((x) => keptAt(reach, 0.2 + x, 0));
    along.slice(1).forEach((k, i) => expect(k).toBeLessThanOrEqual(along[i] ?? 1));
  });
});
