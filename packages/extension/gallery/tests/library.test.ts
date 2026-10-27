/**
 * The library is read from structure and tags alone: a style's facet is its
 * nearest #facet ancestor, facets keep outline order, and the filter is
 * faceted search's (OR within a facet, AND across, counts that never zero a
 * chosen facet's siblings).
 */
import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS, type PropValue } from "@kb/model";
import {
  GALLERY_IDS,
  aspectOf,
  coverOf,
  facetCounts,
  filterVisuals,
  imageSourcesOf,
  libraryOf,
  orderedStyles,
  searchUrlOf,
  type GraphNode,
} from "@kb/gallery";

const ref = (v: string): PropValue => ({ t: "ref", v });
const str = (v: string): PropValue => ({ t: "str", v });

function n(
  id: string,
  text: string,
  props: Record<string, PropValue[]> = {},
  children: string[] = [],
): GraphNode {
  return { id, text, props, children };
}
const tag = (id: string) => ({ [SYSTEM_IDS.typeField]: [ref(id)] });
const style = (id: string, text: string, extra: Record<string, PropValue[]> = {}) =>
  n(id, text, { ...tag(GALLERY_IDS.styleTag), ...extra });
const visual = (
  id: string,
  text: string,
  styles: string[],
  extra: Record<string, PropValue[]> = {},
) =>
  n(id, text, {
    ...tag(GALLERY_IDS.visualTag),
    [GALLERY_IDS.stylesField]: styles.map(ref),
    ...extra,
  });

// Styles ─ Lighting (facet) ─ golden, neon
//        └ Medium (facet) ─ Painting (group) ─ oil
//                         └ photo
// plus a style no facet holds, and visuals under a library.
const graph: GraphNode[] = [
  n("styles", "Styles", {}, ["lighting", "medium"]),
  n("lighting", "Lighting", tag(GALLERY_IDS.facetTag), ["golden", "neon"]),
  style("golden", "golden hour"),
  style("neon", "neon", { [GALLERY_IDS.promptField]: [str("{prompt}, neon signs")] }),
  n("medium", "Medium", tag(GALLERY_IDS.facetTag), ["painting", "photo"]),
  n("painting", "Painting", {}, ["oil"]),
  style("oil", "oil painting"),
  style("photo", "photograph"),
  style("loose", "loose style"),
  n("library", "Library", {}, ["v1", "v2", "v3", "v4"]),
  visual("v1", "lighthouse at dusk", ["golden", "photo"], {
    [GALLERY_IDS.mediaField]: [
      str("a note"),
      str("![lh](assets/01A.webp) and ![x](assets/01B.png)"),
    ],
    [GALLERY_IDS.widthField]: [{ t: "num", v: 400 }],
    [GALLERY_IDS.heightField]: [{ t: "num", v: 600 }],
  }),
  visual("v2", "neon street", ["neon", "photo"]),
  visual("v3", "harbour", ["golden", "oil"], {
    [GALLERY_IDS.promptField]: [str("an oil painting of a harbour, neon street lamps")],
  }),
  visual("v4", "untagged", ["loose", "missing-style"]),
];
const library = libraryOf(graph);

describe("libraryOf", () => {
  test("visuals in outline order, and each one's known styles", () => {
    expect(library.visuals.map((v) => v.id)).toEqual(["v1", "v2", "v3", "v4"]);
    expect(library.stylesOf.get("v4")).toEqual(["loose"]);
  });

  test("a style's facet is its nearest #facet ancestor, through plain groups", () => {
    expect(library.styles.get("oil")?.facet).toBe("medium");
    expect(library.styles.get("golden")?.facet).toBe("lighting");
    expect(library.styles.get("loose")?.facet).toBeNull();
    expect(library.facets.map((f) => [f.id, f.styles])).toEqual([
      ["lighting", ["golden", "neon"]],
      ["medium", ["oil", "photo"]],
    ]);
  });

  test("a style without a template composes as its name", () => {
    expect(library.styles.get("golden")?.prompt).toBe("golden hour");
    expect(library.styles.get("neon")?.prompt).toBe("{prompt}, neon signs");
  });

  test("the order the roots come in does not change what is read", () => {
    const reversed = libraryOf(graph.toReversed());
    expect(reversed.facets.map((f) => f.id)).toEqual(["lighting", "medium"]);
    expect([...reversed.styles.keys()].toSorted()).toEqual([...library.styles.keys()].toSorted());
  });
});

const pick = (entries: Array<[string, string[]]>) =>
  new Map(entries.map(([facet, ids]) => [facet, new Set(ids)]));
describe("faceted filter", () => {
  test("OR within a facet, AND across facets", () => {
    const ids = (sel: Map<string, Set<string>>, text = "") =>
      filterVisuals(library, sel, text).map((v) => v.id);
    expect(ids(pick([["lighting", ["golden"]]]))).toEqual(["v1", "v3"]);
    expect(ids(pick([["lighting", ["golden", "neon"]]]))).toEqual(["v1", "v2", "v3"]);
    expect(
      ids(
        pick([
          ["lighting", ["golden", "neon"]],
          ["medium", ["photo"]],
        ]),
      ),
    ).toEqual(["v1", "v2"]);
    expect(ids(pick([]))).toEqual(["v1", "v2", "v3", "v4"]);
  });

  test("text matches the title or the prompt", () => {
    expect(filterVisuals(library, new Map(), "NEON").map((v) => v.id)).toEqual(["v2", "v3"]);
  });

  test("counts are disjunctive: choosing a value never zeroes its siblings", () => {
    const counts = facetCounts(library, pick([["lighting", ["golden"]]]), "");
    // Lighting's values count against every other facet's choice (none).
    expect(counts.get("golden")).toBe(2);
    expect(counts.get("neon")).toBe(1);
    // Medium's values count against the lighting choice.
    expect(counts.get("photo")).toBe(1);
    expect(counts.get("oil")).toBe(1);
  });

  test("with two facets chosen, each facet counts against the other", () => {
    const counts = facetCounts(
      library,
      pick([
        ["lighting", ["golden"]],
        ["medium", ["oil"]],
      ]),
      "",
    );
    expect(counts.get("golden")).toBe(1); // v3 only: v1 is a photo
    expect(counts.has("neon")).toBe(false); // v2 fails both choices
    expect(counts.get("photo")).toBe(1); // v1 matches lighting
    expect(counts.get("oil")).toBe(1);
  });
});

describe("readings of one visual", () => {
  test("the cover is the first asset embed of media", () => {
    expect(coverOf(library.visuals[0] as GraphNode)).toBe("assets/01A.webp");
    expect(coverOf(library.visuals[1] as GraphNode)).toBeNull();
  });

  test("the aspect ratio comes from the recorded size", () => {
    expect(aspectOf(library.visuals[0] as GraphNode)).toBe(1.5);
    expect(aspectOf(library.visuals[1] as GraphNode)).toBeNull();
  });

  test("chosen styles come back in composer order", () => {
    expect(orderedStyles(library, new Set(["photo", "loose", "golden"])).map((s) => s.id)).toEqual([
      "golden",
      "photo",
      "loose",
    ]);
  });

  test("a search url has its query encoded", () => {
    expect(searchUrlOf("https://x.test/s?q={query}", " dolly zoom & $& ")).toBe(
      "https://x.test/s?q=dolly%20zoom%20%26%20%24%26",
    );
  });
});

describe("image sources", () => {
  test("each says its search page and whether kb calls it or the page opens it", () => {
    const sources = imageSourcesOf([
      n("civitai", "Civitai", {
        ...tag(GALLERY_IDS.sourceTag),
        [GALLERY_IDS.sourceKindField]: [ref(GALLERY_IDS.kindCivitai)],
        [GALLERY_IDS.searchUrlField]: [str("https://civitai.com/search?q={query}")],
      }),
      n("pins", "Pinterest", {
        ...tag(GALLERY_IDS.sourceTag),
        [GALLERY_IDS.sourceKindField]: [ref(GALLERY_IDS.kindLink)],
      }),
      n("bare", "No kind", tag(GALLERY_IDS.sourceTag)),
      n("other", "Not a source"),
    ]);
    expect(sources).toEqual([
      {
        id: "civitai",
        text: "Civitai",
        searchUrl: "https://civitai.com/search?q={query}",
        kind: "api",
      },
      { id: "pins", text: "Pinterest", searchUrl: "", kind: "link" },
      { id: "bare", text: "No kind", searchUrl: "", kind: "link" },
    ]);
  });
});
