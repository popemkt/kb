/**
 * The Black hole's looks at the strength a head shows them where no setting
 * chooses one (DESIGN-UI.md → Page-head backdrops → Variants → Its own
 * strength): Warp declares vivid, the owner's pick; Gargantua the default.
 */
import { expect, it } from "vitest";
import { BLACK_HOLE_BACKDROP } from "@kb/backdrops";
import { DEFAULT_BACKDROP_STRENGTH, shownStrength } from "@kb/appearance";

it("shows Warp vivid and Gargantua at the default where nothing chooses a strength", () => {
  expect(shownStrength(null, BLACK_HOLE_BACKDROP, "warp")).toBe("vivid");
  expect(shownStrength(null, BLACK_HOLE_BACKDROP, "gargantua")).toBe(DEFAULT_BACKDROP_STRENGTH);
});

it("keeps a strength a setting chooses over Warp's own", () => {
  expect(shownStrength("subtle", BLACK_HOLE_BACKDROP, "warp")).toBe("subtle");
});
