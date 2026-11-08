/**
 * Where a page head's backdrop shows its corner (DESIGN-UI.md → Page-head
 * backdrops → Its actions): inside its frame's top-right, never down on
 * the page's title, and never under the page's header, where a frame that
 * starts above its breathing room would put it.
 */
import { describe, expect, test } from "vitest";
import { CORNER_HEIGHT, CORNER_INSET, cornerTop } from "./backdrop-corner-place";

describe("a backdrop's corner", () => {
  test("stands inside its frame's top, in the breathing room above the title", () => {
    expect(cornerTop({ offset: 0 }, 120)).toBe(CORNER_INSET);
    expect(cornerTop({ offset: 20 }, 120)).toBe(20 + CORNER_INSET);
  });

  test("a frame that starts behind the header puts it inset below the header, not under it", () => {
    expect(cornerTop({ offset: -10 }, 120)).toBe(CORNER_INSET);
    expect(cornerTop({ offset: -40 }, 120)).toBe(CORNER_INSET);
  });

  test("with too little room, is lifted until it clears the title", () => {
    const top = cornerTop({ offset: 30 }, 60);
    expect(top + CORNER_HEIGHT).toBeLessThanOrEqual(60 - CORNER_INSET);
    expect(top).toBeGreaterThanOrEqual(CORNER_INSET);
  });

  test("with no room to clear the title, keeps its inset below the header", () => {
    expect(cornerTop({ offset: -40 }, 0)).toBe(CORNER_INSET);
    expect(cornerTop({ offset: 0 }, 20)).toBe(CORNER_INSET);
  });
});
