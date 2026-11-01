import { describe, expect, it } from "vitest";
import { SYSTEM_IDS, type PropValue } from "@kb/model";
import { GALLERY_IDS, libraryOf, type GraphNode } from "@kb/gallery";
import { filling, hashTermAt, partsOf, referenceOrder } from "./scene-model";

const ref = (v: string): PropValue => ({ t: "ref", v });
const n = (
  id: string,
  tag: string | null,
  children: string[] = [],
  text = id,
  styles: string[] = [],
): GraphNode => ({
  id,
  text,
  props: {
    ...(tag === null ? {} : { [SYSTEM_IDS.typeField]: [ref(tag)] }),
    ...(styles.length === 0 ? {} : { [GALLERY_IDS.stylesField]: styles.map(ref) }),
  },
  children,
});
const library = libraryOf([
  n("styles", null, ["lens", "lighting", "angle", "texture", "artist"]),
  n("lens", GALLERY_IDS.facetTag, ["wide"], "Lens"),
  n("wide", GALLERY_IDS.styleTag),
  n("lighting", GALLERY_IDS.facetTag, ["golden", "noir"], "Lighting"),
  n("golden", GALLERY_IDS.styleTag),
  n("noir", GALLERY_IDS.styleTag),
  n("angle", GALLERY_IDS.facetTag, ["low"], "Camera angle"),
  n("low", GALLERY_IDS.styleTag),
  n("texture", GALLERY_IDS.facetTag, ["grain"], "Grit"),
  n("grain", GALLERY_IDS.styleTag),
  // No style yet: no part of the scene.
  n("artist", GALLERY_IDS.facetTag, [], "Artist"),
  n("library", null, ["v1", "v2", "v3"]),
  n("v1", GALLERY_IDS.visualTag, [], "v1", ["golden", "low"]),
  n("v2", GALLERY_IDS.visualTag, [], "v2", ["golden", "low", "grain"]),
  n("v3", GALLERY_IDS.visualTag, [], "v3", ["noir"]),
]);

describe("the parts of a scene", () => {
  it("are the library's axes it has styles for, and a facet no axis names is a part of its own", () => {
    expect(partsOf(library).map((axis) => axis.label)).toEqual([
      "Lighting",
      "Camera and lens",
      "Composition",
      "Grit",
    ]);
  });

  it("are filled by the look's styles of their facets, in the library's order", () => {
    const lighting = partsOf(library).find((axis) => axis.label === "Lighting");
    expect(lighting).toBeDefined();
    if (lighting === undefined) return;
    expect(filling(library, lighting, ["noir", "low", "golden"]).map((s) => s.id)).toEqual([
      "golden",
      "noir",
    ]);
    expect(filling(library, lighting, ["low"])).toEqual([]);
  });
});

describe("the scene's field", () => {
  it("is completing the #term typed up to the caret, many words long", () => {
    const text = "a pagoda at dawn, #golden ho";
    expect(hashTermAt(text, text.length)).toEqual({ at: 18, term: "golden ho" });
    expect(hashTermAt("#", 1)).toEqual({ at: 0, term: "" });
  });

  it("is completing nothing once the term is ended, or with no #", () => {
    expect(hashTermAt("#golden, a pagoda", 17)).toBeNull();
    expect(hashTermAt("a pagoda", 8)).toBeNull();
    expect(hashTermAt("#golden\nnext", 12)).toBeNull();
  });
});

describe("the references a scene offers", () => {
  it("are the pinned, then those most like them, then the rest of the library", () => {
    expect(referenceOrder(library, [])).toEqual(["v1", "v2", "v3"]);
    expect(referenceOrder(library, ["v3"])).toEqual(["v3", "v1", "v2"]);
    expect(referenceOrder(library, ["v1"])).toEqual(["v1", "v2", "v3"]);
  });
});
