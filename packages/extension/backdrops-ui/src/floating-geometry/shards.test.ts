import { describe, expect, it } from "vitest";
import { seededRng } from "../scene/rng";
import { FACES, layoutShards, projectShards, rotate, type Vec3 } from "./shards";

const AT = { x: 0.4, y: 0.05, scale: 1, lean: [0, 0] } as const;
const area = (f: { a: readonly number[]; b: readonly number[]; c: readonly number[] }) => {
  const [ax = 0, ay = 0] = f.a;
  const [bx = 0, by = 0] = f.b;
  const [cx = 0, cy = 0] = f.c;
  return Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
};

describe("layoutShards", () => {
  it("is the seed's, and never lays out more faces than the shader reads", () => {
    for (let seed = 1; seed < 200; seed++) {
      const { pieces, knots } = layoutShards(seededRng(seed));
      expect(pieces.reduce((n, p) => n + p.faces.length, 0)).toBeLessThanOrEqual(FACES);
      expect(knots[0]).toEqual([0, 0, 0]);
    }
    expect(layoutShards(seededRng(7))).toEqual(layoutShards(seededRng(7)));
    expect(layoutShards(seededRng(7))).not.toEqual(layoutShards(seededRng(8)));
  });

  it("fans each knot's shards out from tips that nearly meet at it", () => {
    const { pieces, knots } = layoutShards(seededRng(3));
    const main = knots[0] ?? [0, 0, 0];
    // The main knot's two fans come first; each face's first corner is its tip.
    for (const piece of pieces.slice(0, 2)) {
      const tip = piece.faces[0]?.[0] ?? [9, 9, 9];
      const at = [piece.centre[0] + tip[0], piece.centre[1] + tip[1]];
      expect(Math.hypot((at[0] ?? 0) - main[0], (at[1] ?? 0) - main[1])).toBeLessThan(0.08);
    }
  });
});

describe("projectShards", () => {
  const { pieces } = layoutShards(seededRng(11));

  it("hands the shader exactly FACES faces, the spare ones empty", () => {
    const faces = projectShards(pieces, 0, AT, [0.4, 0], 0);
    const used = pieces.reduce((n, p) => n + p.faces.length, 0);
    expect(faces).toHaveLength(FACES);
    faces.slice(used).forEach((f) => expect(area(f)).toBe(0));
    faces.slice(0, used).forEach((f) => expect(area(f)).toBeGreaterThan(0));
  });

  it("sways and drifts but never wanders off: the composition holds over minutes", () => {
    const rest = projectShards(pieces, 0, AT, [0.4, 0], 0);
    for (const t of [10, 60, 240, 900]) {
      const later = projectShards(pieces, t, AT, [0.4, 0], 0);
      later.forEach((f, i) => {
        const r = rest[i];
        if (r === undefined) return;
        expect(Math.hypot(f.a[0] - r.a[0], f.a[1] - r.a[1])).toBeLessThan(0.35);
      });
    }
  });

  it("slides the near pieces further than the far ones as the eye leans (parallax)", () => {
    const rest = projectShards(pieces, 0, AT, [0.4, 0], 0);
    const leant = projectShards(pieces, 0, { ...AT, lean: [0.5, 0] }, [0.4, 0], 0);
    const shift = (i: number) => (leant[i]?.a[0] ?? 0) - (rest[i]?.a[0] ?? 0);
    const used = pieces.flatMap((p) => p.faces.map(() => p.depth));
    const nearest = used.indexOf(Math.min(...used));
    const farthest = used.indexOf(Math.max(...used));
    expect(shift(nearest)).toBeLessThan(0);
    expect(Math.abs(shift(nearest))).toBeGreaterThan(Math.abs(shift(farthest)));
  });

  it("lights a face by how squarely it faces the lamp, within 0–1", () => {
    for (const t of [0, 5, 13]) {
      for (const f of projectShards(pieces, t, AT, [0.4, 0], 0.3)) {
        expect(f.lit).toBeGreaterThanOrEqual(0);
        expect(f.lit).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("rotate", () => {
  it("turns about its axis and keeps length", () => {
    const v: Vec3 = [1, 0, 0];
    const r = rotate(v, [0, 0, 1], Math.PI / 2);
    expect(r[0]).toBeCloseTo(0);
    expect(r[1]).toBeCloseTo(1);
    expect(Math.hypot(...rotate([0.3, -0.4, 0.5], [0.6, 0, 0.8], 1.1))).toBeCloseTo(
      Math.hypot(0.3, -0.4, 0.5),
    );
  });
});
