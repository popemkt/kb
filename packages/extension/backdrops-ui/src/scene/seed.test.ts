import { describe, expect, it } from "vitest";
import { drawVariant, turnHue, variation } from "./seed";

function draw(seed: number) {
  const vary = variation(seed);
  return [vary.range("a", 0, 1), vary.phase("b"), vary.sign("c"), vary.stream("d").next()];
}

describe("variation", () => {
  it("draws the same for the same seed, and differently for another", () => {
    expect(draw(42)).toEqual(draw(42));
    expect(draw(42)).not.toEqual(draw(43));
  });

  it("keys each draw by its name, so one draw never moves another", () => {
    const vary = variation(9);
    const alone = variation(9).range("hue", -1, 1);
    vary.range("added before", 0, 1);
    vary.stream("a layout").next();
    expect(vary.range("hue", -1, 1)).toBe(alone);
    expect(vary.range("hue", -1, 1)).not.toBe(vary.range("other", -1, 1));
  });

  it("keeps every draw within its range over many seeds", () => {
    const options = ["a", "b", "c"] as const;
    const seen = new Set<string>();
    for (let seed = 0; seed < 400; seed++) {
      const vary = variation(seed);
      const value = vary.range("x", 2, 3);
      expect(value).toBeGreaterThanOrEqual(2);
      expect(value).toBeLessThan(3);
      const phase = vary.phase("p");
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(Math.PI * 2);
      expect([1, -1]).toContain(vary.sign("s"));
      seen.add(vary.pick("o", options));
    }
    expect([...seen].toSorted()).toEqual([...options]);
  });
});

describe("turnHue", () => {
  it("keeps grey and the mean, and a full turn is no turn", () => {
    expect(turnHue([0.4, 0.4, 0.4], 1.2).map((c) => c.toFixed(6))).toEqual([
      "0.400000",
      "0.400000",
      "0.400000",
    ]);
    const rgb = [0.9, 0.3, 0.1] as const;
    const turned = turnHue(rgb, 0.7);
    expect(turned.reduce((a, b) => a + b)).toBeCloseTo(1.3, 9);
    turnHue(rgb, Math.PI * 2).forEach((c, i) => expect(c).toBeCloseTo(rgb[i] ?? 0, 9));
  });
});

describe("drawVariant", () => {
  const SHOWN = ["dusk", "night", "noon"] as const;

  it("draws one of the shown by the seed, the same every time for one load", () => {
    const drawn = drawVariant(42, SHOWN, null);
    expect(SHOWN).toContain(drawn);
    expect(drawVariant(42, SHOWN, null)).toBe(drawn);
    const seen = new Set(Array.from({ length: 40 }, (_, seed) => drawVariant(seed, SHOWN, null)));
    expect(seen.size).toBe(SHOWN.length);
  });

  it("keeps the one shown while it is still among them, and draws again when it is not", () => {
    expect(drawVariant(42, ["night", "noon"], "night")).toBe("night");
    expect(drawVariant(42, ["noon"], "night")).toBe("noon");
  });

  it("is none for a backdrop with no variants", () => {
    expect(drawVariant(42, [], null)).toBeNull();
    expect(drawVariant(42, [], "night")).toBeNull();
  });
});
