import { describe, expect, it } from "vitest";
import { seededRng } from "../scene/rng";
import { SHEETS, layoutWeb, placeSheets } from "./web";

const AT = { x: 0.4, y: 0.05, scale: 1, lean: [0, 0] } as const;

describe("layoutWeb", () => {
  it("is the seed's, and lays out exactly the sheets the shader reads", () => {
    for (let seed = 1; seed < 200; seed++) {
      const { sheets, knots } = layoutWeb(seededRng(seed));
      expect(sheets).toHaveLength(SHEETS);
      expect(knots[0]?.slice(0, 2)).toEqual([0, 0]);
    }
    expect(layoutWeb(seededRng(7))).toEqual(layoutWeb(seededRng(7)));
    expect(layoutWeb(seededRng(7))).not.toEqual(layoutWeb(seededRng(8)));
  });

  it("lays out large facets: the far web's larger still, faint behind the piece", () => {
    for (let seed = 1; seed < 50; seed++) {
      const [near, far] = layoutWeb(seededRng(seed)).sheets;
      if (near === undefined || far === undefined) throw new Error("a sheet went missing");
      // A facet is a large share of the frame's height: three or fewer across it.
      expect(near.cell).toBeGreaterThan(0.25);
      expect(far.cell).toBeGreaterThan(near.cell);
      expect(near.depth).toBeLessThan(far.depth);
    }
  });

  it("gathers the light in knots spread across a frame twice as wide as it is high", () => {
    for (let seed = 1; seed < 50; seed++) {
      const xs = layoutWeb(seededRng(seed)).knots.map(([x]) => x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.7);
    }
  });
});

describe("placeSheets", () => {
  const { sheets } = layoutWeb(seededRng(11));

  it("slides each sheet but never far: the composition holds over minutes", () => {
    const rest = placeSheets(sheets, 0, AT);
    for (const t of [10, 60, 240, 900]) {
      placeSheets(sheets, t, AT).forEach((sheet, n) => {
        const r = rest[n];
        if (r === undefined) throw new Error("a sheet went missing");
        expect(Math.hypot(sheet.x - r.x, sheet.y - r.y)).toBeLessThan(0.1);
      });
    }
  });

  it("slides the near sheet further than the far one as the eye leans (parallax)", () => {
    const rest = placeSheets(sheets, 0, AT);
    const leant = placeSheets(sheets, 0, { ...AT, lean: [0.5, 0] });
    const shift = (n: number) => (leant[n]?.x ?? 0) - (rest[n]?.x ?? 0);
    expect(shift(0)).toBeLessThan(0);
    expect(Math.abs(shift(0))).toBeGreaterThan(Math.abs(shift(1)));
  });

  it("reports how far each sheet slid, so what rides on it slides with it", () => {
    const rest = placeSheets(sheets, 0, AT);
    const later = placeSheets(sheets, 37, { ...AT, lean: [0.3, -0.2] });
    later.forEach((sheet, n) => {
      const r = rest[n];
      if (r === undefined) throw new Error("a sheet went missing");
      expect(sheet.x - r.x).toBeCloseTo(sheet.slid[0] - r.slid[0], 9);
      expect(sheet.y - r.y).toBeCloseTo(sheet.slid[1] - r.slid[1], 9);
    });
  });

  it("scales the web about the main knot", () => {
    const [whole] = placeSheets(sheets, 0, AT);
    const [half] = placeSheets(sheets, 0, { ...AT, scale: 0.5 });
    expect(half?.cell).toBeCloseTo((whole?.cell ?? 0) * 0.5, 9);
  });
});
