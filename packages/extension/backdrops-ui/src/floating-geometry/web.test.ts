import { describe, expect, it } from "vitest";
import { seededRng } from "../scene/rng";
import { SHEETS, fitPiece, layoutWeb, pieceBounds, placeSheets } from "./web";

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
      // A facet is a large share of the frame's height: four or fewer across it.
      expect(near.cell).toBeGreaterThan(0.23);
      expect(far.cell).toBeGreaterThan(near.cell);
      expect(near.depth).toBeLessThan(far.depth);
    }
  });

  it("hangs the piece from above its hot point: the main knot lowest, the others spread above it", () => {
    for (let seed = 1; seed < 50; seed++) {
      const { knots } = layoutWeb(seededRng(seed));
      const xs = knots.map(([x]) => x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.55);
      for (const [, y] of knots.slice(1)) expect(y).toBeGreaterThan(0);
    }
  });

  it("puts a corner of the near sheet on the main knot, so the light gathers on one", () => {
    for (let seed = 1; seed < 50; seed++) {
      expect(layoutWeb(seededRng(seed)).sheets[0]?.offset.map(Math.abs)).toEqual([0, 0]);
    }
  });
});

describe("fitPiece", () => {
  const margin = { sides: 0.1, bottom: 0.07 };

  it("leaves a piece where the composition puts it when the frame has room", () => {
    const bounds = { left: -0.4, right: 0.4, bottom: -0.3 };
    expect(fitPiece(bounds, { x: 0.2, y: 0.1, scale: 1 }, 2, margin)).toEqual({
      x: 0.2,
      y: 0.1,
      scale: 1,
    });
  });

  it("keeps every facet inside the sides and the bottom, sliding before it shrinks", () => {
    for (let seed = 1; seed < 50; seed++) {
      const bounds = pieceBounds(layoutWeb(seededRng(seed)));
      for (const aspect of [0.95, 1.4, 2, 3]) {
        for (const x of [-aspect / 2, 0, aspect / 2]) {
          const hub = fitPiece(bounds, { x, y: -0.4, scale: 1 }, aspect, margin);
          expect(hub.x + bounds.right * hub.scale).toBeLessThanOrEqual(aspect / 2 - 0.1 + 1e-9);
          expect(hub.x + bounds.left * hub.scale).toBeGreaterThanOrEqual(-aspect / 2 + 0.1 - 1e-9);
          expect(hub.y + bounds.bottom * hub.scale).toBeGreaterThanOrEqual(-0.5 + 0.07 - 1e-9);
          expect(hub.scale).toBeLessThanOrEqual(1);
        }
      }
    }
    // Room enough across, so it slides rather than shrinks.
    const wide = fitPiece(
      { left: -0.4, right: 0.4, bottom: -0.3 },
      { x: 1.2, y: 0, scale: 1 },
      3,
      margin,
    );
    expect(wide.scale).toBe(1);
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
