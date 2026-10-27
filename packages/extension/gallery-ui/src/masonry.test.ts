import { describe, expect, it } from "vitest";
import { clampAspect, columnCount, layoutMasonry, visibleTiles } from "./masonry";

const OPTIONS = { minColumn: 200, gap: 10, caption: 20 };

describe("layoutMasonry", () => {
  it("fits as many columns as the width allows, at least one", () => {
    expect(columnCount(620, OPTIONS)).toBe(3);
    expect(columnCount(619, OPTIONS)).toBe(2);
    expect(columnCount(50, OPTIONS)).toBe(1);
  });

  it("puts each tile into the shortest column, in order", () => {
    // Three columns of 200: a tall first tile sends the fourth to the next shortest.
    const layout = layoutMasonry([2, 1, 0.5, 1], 620, OPTIONS);
    expect(layout.columnWidth).toBe(200);
    expect(layout.tiles.map((t) => [t.x, t.y, t.height])).toEqual([
      [0, 0, 400],
      [210, 0, 200],
      [420, 0, 100],
      [420, 130, 200],
    ]);
    expect(layout.columns).toEqual([[0], [1], [2, 3]]);
    expect(layout.height).toBe(420);
  });

  it("draws an unknown or extreme aspect within bounds", () => {
    expect(clampAspect(null)).toBe(1);
    expect(clampAspect(Number.NaN)).toBe(1);
    expect(clampAspect(0.01)).toBe(0.4);
    expect(clampAspect(40)).toBe(2.5);
  });
});

describe("visibleTiles", () => {
  const aspects = Array.from({ length: 5000 }, (_, i) => 0.5 + ((i * 7919) % 100) / 50);
  const layout = layoutMasonry(aspects, 1240, OPTIONS);

  it("answers exactly the tiles that meet the window, in placement order", () => {
    for (const top of [0, 1234, 50_000, layout.height - 300]) {
      const bottom = top + 900;
      const expected = layout.tiles.filter((t) => t.y <= bottom && t.y + t.height + 20 >= top);
      expect(visibleTiles(layout, top, bottom)).toEqual(expected);
    }
  });

  it("shows a window's worth, not the library", () => {
    expect(visibleTiles(layout, 10_000, 11_000).length).toBeLessThan(40);
  });

  it("an empty library shows nothing", () => {
    const empty = layoutMasonry([], 800, OPTIONS);
    expect(empty.height).toBe(0);
    expect(visibleTiles(empty, 0, 1000)).toEqual([]);
  });
});
