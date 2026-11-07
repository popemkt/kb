/**
 * Where a page head's backdrop shows its corner (DESIGN-UI.md → Page-head
 * backdrops → Its actions): inside its frame's top-right, and never down
 * on the page's title, however little breathing room the backdrop keeps.
 */
import { describe, expect, test } from "vitest";
import { CORNER_HEIGHT, CORNER_INSET, cornerTop } from "./backdrop-corner-place";

describe("a backdrop's corner", () => {
  test("stands inside its frame's top, in the breathing room above the title", () => {
    expect(cornerTop({ offset: -10 }, 120)).toBe(-10 + CORNER_INSET);
    expect(cornerTop({ offset: 0 }, 120)).toBe(CORNER_INSET);
  });

  test("with no breathing room, stands above the title, clear of it", () => {
    const top = cornerTop({ offset: -40 }, 0);
    expect(top + CORNER_HEIGHT).toBeLessThanOrEqual(-CORNER_INSET);
  });

  test("with too little, is lifted until it clears the title", () => {
    const top = cornerTop({ offset: 0 }, 20);
    expect(top + CORNER_HEIGHT).toBeLessThanOrEqual(20 - CORNER_INSET);
  });
});
