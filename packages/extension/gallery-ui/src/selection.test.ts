import { describe, expect, it } from "vitest";
import { SYSTEM_IDS, type PropValue } from "@kb/model";
import { GALLERY_IDS, UNFILED, libraryOf, type GraphNode } from "@kb/gallery";
import { chosenStyles, liveSelection, selectionOf, toggleStyle } from "./selection";

const ref = (v: string): PropValue => ({ t: "ref", v });
const n = (id: string, tag: string | null, children: string[] = []): GraphNode => ({
  id,
  text: id,
  props: tag === null ? {} : { [SYSTEM_IDS.typeField]: [ref(tag)] },
  children,
});
const library = libraryOf([
  n("styles", null, ["light", "angle", "loose"]),
  n("light", GALLERY_IDS.facetTag, ["golden", "neon"]),
  n("golden", GALLERY_IDS.styleTag),
  n("neon", GALLERY_IDS.styleTag),
  n("angle", GALLERY_IDS.facetTag, ["low"]),
  n("low", GALLERY_IDS.styleTag),
  n("loose", GALLERY_IDS.styleTag),
]);

describe("the facet selection", () => {
  it("toggles a style within its facet, and drops a facet left empty", () => {
    const one = toggleStyle(library, new Map(), "golden");
    const two = toggleStyle(library, one, "neon");
    expect([...(two.get("light") ?? [])]).toEqual(["golden", "neon"]);
    const back = toggleStyle(library, toggleStyle(library, two, "golden"), "neon");
    expect(back.size).toBe(0);
  });

  it("files a style no facet holds as unfiled", () => {
    expect(toggleStyle(library, new Map(), "loose").has(UNFILED)).toBe(true);
  });

  it("takes a visual's styles as the selection, skipping what is not a style", () => {
    const selection = selectionOf(library, ["low", "golden", "gone"]);
    expect([...selection.keys()]).toEqual(["angle", "light"]);
    expect([...chosenStyles(selection)]).toEqual(["low", "golden"]);
  });
  it("reads a chosen style where the library files it now, and drops one it no longer holds", () => {
    const chosen = selectionOf(library, ["golden", "low"]);
    // "golden" moved from Light to Angle, and "low" was deleted, in another tab.
    const now = libraryOf([
      n("styles", null, ["light", "angle"]),
      n("light", GALLERY_IDS.facetTag, ["neon"]),
      n("neon", GALLERY_IDS.styleTag),
      n("angle", GALLERY_IDS.facetTag, ["golden"]),
      n("golden", GALLERY_IDS.styleTag),
    ]);
    const live = liveSelection(now, chosen);
    expect([...live.keys()]).toEqual(["angle"]);
    expect([...(live.get("angle") ?? [])]).toEqual(["golden"]);
  });
});
