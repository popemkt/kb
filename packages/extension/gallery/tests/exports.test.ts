/**
 * A look's exports: one list, each a rendering of the look. The 3D art
 * direction writes each chosen style with its notes, and every style it is
 * made with, however deep, under that style's own facet and marked with
 * the chosen style that calls for it; a style's notes are read from its
 * fields like any other value.
 */
import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS, type PropValue } from "@kb/model";
import {
  EMPTY_LOOK,
  GALLERY_IDS,
  LOOK_EXPORTS,
  artDirectionOf,
  exportFileName,
  libraryOf,
  stylesCalledFor,
  type GraphNode,
  type LookDraft,
} from "@kb/gallery";

const ref = (v: string): PropValue => ({ t: "ref", v });
const str = (v: string): PropValue => ({ t: "str", v });
const n = (
  id: string,
  text: string,
  props: Record<string, PropValue[]> = {},
  children: string[] = [],
): GraphNode => ({ id, text, props, children });
const tag = (id: string) => ({ [SYSTEM_IDS.typeField]: [ref(id)] });
const facet = (id: string, text: string, children: string[]) =>
  n(id, text, tag(GALLERY_IDS.facetTag), children);
const style = (id: string, text: string, props: Record<string, PropValue[]> = {}) =>
  n(id, text, { ...tag(GALLERY_IDS.styleTag), ...props });

const NODES: GraphNode[] = [
  n("styles", "Styles", {}, ["s3d", "light", "tech"]),
  facet("s3d", "3D style", ["cel"]),
  style("cel", "cel-shaded", {
    [GALLERY_IDS.descriptionField]: [str("Two or three hard tone bands and a dark outline.")],
    [GALLERY_IDS.madeWithField]: [ref("ramp"), ref("hull")],
    [GALLERY_IDS.seenInField]: [str("A sailing game"), str("A skating game")],
    [GALLERY_IDS.howToField]: [
      str("Three.js: MeshToonMaterial with a gradientMap."),
      str("Blender: Shader to RGB into a Color Ramp."),
    ],
  }),
  facet("light", "Lighting", ["golden", "key", "blue"]),
  style("golden", "golden hour"),
  style("key", "toon key light"),
  style("blue", "blue hour", { [GALLERY_IDS.seenInField]: [str("A harbour at dusk")] }),
  facet("tech", "Rendering technique", ["ramp", "hull", "flat"]),
  // A toon ramp is made with flat shading, which calls for the ramp again: a cycle, read once.
  style("ramp", "toon ramp", {
    [GALLERY_IDS.howToField]: [str("Three.js: a NearestFilter DataTexture.")],
    [GALLERY_IDS.madeWithField]: [ref("flat")],
  }),
  style("hull", "inverted hull outline"),
  style("flat", "flat shading", { [GALLERY_IDS.madeWithField]: [ref("ramp"), ref("gone")] }),
];
const library = libraryOf(NODES);
const byId = new Map(NODES.map((node) => [node.id, node]));
const get = (id: string) => byId.get(id);

const draft: LookDraft = {
  ...EMPTY_LOOK,
  name: "Pagoda at dusk",
  description: "the One Pillar Pagoda at dusk",
  styles: ["golden", "cel", "blue"],
  negative: "photoreal",
  palette: ["#8e1d10", "#c8922c"],
};

describe("a look's exports", () => {
  test("are the brief and the 3D art direction, each its own file", () => {
    expect(LOOK_EXPORTS.map((target) => target.id)).toEqual(["brief", "art-direction"]);
    const [brief, art] = LOOK_EXPORTS;
    if (brief === undefined || art === undefined) throw new Error("no exports");
    expect(exportFileName("Pagoda: at dusk!", brief)).toBe("Pagoda at dusk.md");
    expect(exportFileName("Pagoda at dusk", art)).toBe("Pagoda at dusk 3D art direction.md");
    expect(exportFileName("", art)).toBe("look 3D art direction.md");
  });
});

describe("the 3D art direction", () => {
  test("a style's notes are read from its fields, its made-with only what the library knows", () => {
    const cel = library.styles.get("cel");
    expect(cel?.description).toBe("Two or three hard tone bands and a dark outline.");
    expect(cel?.madeWith).toEqual(["ramp", "hull"]);
    expect(cel?.seenIn).toEqual(["A sailing game", "A skating game"]);
    expect(library.styles.get("flat")?.madeWith).toEqual(["ramp"]);
    expect(library.styles.get("golden")?.madeWith).toEqual([]);
  });

  test("the chosen styles call for what they are made with, however deep, once", () => {
    const called = stylesCalledFor(draft, library);
    expect([...called.keys()].toSorted()).toEqual([
      "blue",
      "cel",
      "flat",
      "golden",
      "hull",
      "ramp",
    ]);
    expect(called.get("golden")).toEqual([]);
    expect(called.get("ramp")).toEqual(["cel"]);
    expect(called.get("flat")).toEqual(["cel"]);
  });

  test("writes each facet's styles with their notes, and what they call for under its own facet", () => {
    const text = artDirectionOf(draft, library, get);
    expect(
      text.startsWith("# 3D art direction: Pagoda at dusk\n\nthe One Pillar Pagoda at dusk"),
    ).toBe(true);
    const at = (needle: string) => text.indexOf(needle);
    // Facets in the composer's order: 3D style, Lighting, Rendering technique.
    expect(at("## 3D style")).toBeLessThan(at("## Lighting"));
    expect(at("## Lighting")).toBeLessThan(at("## Rendering technique"));
    expect(text).toContain(
      [
        "### cel-shaded",
        "",
        "Two or three hard tone bands and a dark outline.",
        "",
        "- Made with: toon ramp, inverted hull outline",
        "- Seen in: A sailing game; A skating game",
        "- Three.js: MeshToonMaterial with a gradientMap.",
        "- Blender: Shader to RGB into a Color Ramp.",
      ].join("\n"),
    );
    // A style with no notes is a line; one the look did not choose says what calls for it.
    expect(text).toContain("- golden hour\n");
    // A style whose only note is where it is seen still says so.
    expect(text).toContain("### blue hour\n\n- Seen in: A harbour at dusk\n");
    expect(text).not.toContain("toon key light");
    expect(text).toContain("### toon ramp (for cel-shaded)");
    expect(text).toContain("- inverted hull outline (for cel-shaded)");
    expect(text).toContain("### flat shading (for cel-shaded)");
    expect(text).toContain("## Palette\n\n- `#8e1d10`\n- `#c8922c`");
    expect(text).toContain("## Avoid\n\nphotoreal");
    // It is for building: no image model's prompt.
    expect(text).not.toContain("## Prompts");
  });

  test("a look with no styles has nothing to build", () => {
    expect(artDirectionOf({ ...draft, styles: [] }, library, get)).toBe("");
  });
});
