import { describe, expect, it } from "vitest";
import { SYSTEM_IDS, type PropValue } from "@kb/model";
import { GALLERY_IDS, libraryOf, type GraphNode } from "@kb/gallery";
import { complete, namesTerm } from "./complete";

const ref = (v: string): PropValue => ({ t: "ref", v });
const n = (
  id: string,
  text: string,
  children: string[] = [],
  madeWith: string[] = [],
): GraphNode => ({
  id,
  text,
  props: {
    [SYSTEM_IDS.typeField]: [
      ref(children.length > 0 ? GALLERY_IDS.facetTag : GALLERY_IDS.styleTag),
    ],
    ...(madeWith.length === 0 ? {} : { [GALLERY_IDS.madeWithField]: madeWith.map(ref) }),
  },
  children,
});
const library = libraryOf([
  n("look", "3D style", ["cel", "cartoon"]),
  n("cel", "cel-shaded", [], ["ramp"]),
  n("cartoon", "cartoon"),
  n("tech", "Rendering technique", ["ramp", "glow"]),
  n("ramp", "toon ramp"),
  n("glow", "neon night glow"),
]);
const texts = (term: string, chosen: string[] = []) =>
  complete(library, term, new Set(chosen)).map((s) => s.text);

describe("completing a term", () => {
  it("matches the start of a word, not its middle", () => {
    expect(namesTerm("toon ramp", "toon")).toBe(true);
    expect(namesTerm("cel-shaded", "shad")).toBe(true);
    expect(namesTerm("cartoon", "toon")).toBe(false);
    expect(namesTerm("neon night glow", "low")).toBe(false);
    expect(namesTerm("golden hour", "golden h")).toBe(true);
  });

  it("offers the styles a term names, then the styles made with them", () => {
    expect(texts("toon")).toEqual(["toon ramp", "cel-shaded"]);
    expect(texts("toon", ["ramp"])).toEqual(["cel-shaded"]);
    expect(texts("low")).toEqual([]);
  });
});
