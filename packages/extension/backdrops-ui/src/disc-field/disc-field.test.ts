import { describe, expect, it } from "vitest";
import { variation } from "../scene/seed";
import { FOLIAGE, bakeVineyard, groundAt, rampAt, type DiscCloud } from "./disc-field";

const TOTAL = 20_000;
const bake = (seed: number) => bakeVineyard(variation(seed), TOTAL);

/** Each disc's place, as triples. */
const places = (cloud: DiscCloud) =>
  Array.from({ length: cloud.count }, (_, i) => [
    cloud.place[i * 3] ?? 0,
    cloud.place[i * 3 + 1] ?? 0,
    cloud.place[i * 3 + 2] ?? 0,
  ]);

/** The share of `discs` that lie on the ground (the path and the lanes' grass). */
const onGround = (discs: readonly number[][]) =>
  discs.filter(([, y = 0, z = 0]) => Math.abs(y - groundAt(z)) < 1e-4).length / discs.length;

describe("rampAt", () => {
  it("runs from its first stop to its last, clamped past either end", () => {
    const leaves = FOLIAGE[0] ?? [];
    expect(rampAt(leaves, 0)).toEqual(leaves[0]);
    expect(rampAt(leaves, 1)).toEqual(leaves.at(-1));
    expect(rampAt(leaves, -3)).toEqual(leaves[0]);
    expect(rampAt(leaves, 7)).toEqual(leaves.at(-1));
  });
});

describe("bakeVineyard", () => {
  it("lays the same vineyard out for the same seed, and another for another", () => {
    expect(bake(3).place).toEqual(bake(3).place);
    expect(bake(3).place).not.toEqual(bake(4).place);
  });

  it("bakes about the discs it is asked for, every value in range", () => {
    const cloud = bake(7);
    expect(cloud.count).toBeGreaterThan(TOTAL * 0.9);
    expect(cloud.count).toBeLessThan(TOTAL * 1.1);
    expect(cloud.place.every(Number.isFinite)).toBe(true);
    expect(cloud.colour.every((c) => c >= 0 && c <= 1)).toBe(true);
    expect(cloud.draw.every((d) => d >= 0 && d < 1)).toBe(true);
    expect(cloud.sway.every((s) => s >= 0 && s <= 1.5)).toBe(true);
  });

  it("draws nothing under the ground", () => {
    for (const [, y = 0, z = 0] of places(bake(11))) {
      expect(y).toBeGreaterThanOrEqual(groundAt(z) - 1.01);
    }
  });

  it("is shuffled, so any prefix is a fair subset of the whole lane", () => {
    const discs = places(bake(5));
    const whole = onGround(discs);
    expect(whole).toBeGreaterThan(0.25);
    for (const share of [0.55, 0.8]) {
      expect(onGround(discs.slice(0, Math.round(discs.length * share)))).toBeCloseTo(whole, 1);
    }
  });
});
