import { describe, expect, it } from "vitest";
import { SYSTEM_IDS, type PropValue } from "@kb/model";
import { GALLERY_IDS, libraryOf, type GraphNode } from "@kb/gallery";
import { groupByFacet, linkOf, linkVisualInput, nextUntriaged, untriagedOf } from "./capture-model";

const ref = (v: string): PropValue => ({ t: "ref", v });
const n = (
  id: string,
  tag: string | null,
  children: string[] = [],
  styles: string[] = [],
): GraphNode => ({
  id,
  text: id,
  props: {
    ...(tag === null ? {} : { [SYSTEM_IDS.typeField]: [ref(tag)] }),
    ...(styles.length === 0 ? {} : { [GALLERY_IDS.stylesField]: styles.map(ref) }),
  },
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
  n("a", GALLERY_IDS.visualTag),
  n("b", GALLERY_IDS.visualTag, [], ["golden"]),
  n("c", GALLERY_IDS.visualTag),
]);
const style = (id: string) => {
  const found = library.styles.get(id);
  if (found === undefined) throw new Error(id);
  return found;
};

describe("a captured link", () => {
  it("is one https URL, named by its last path segment", () => {
    expect(linkOf("  https://example.com/pics/Dusk%20sky.JPG ", true)).toEqual({
      url: "https://example.com/pics/Dusk%20sky.JPG",
      name: "Dusk sky.JPG",
    });
  });

  it("is a picture's only when its path ends in a picture's extension, unless the person says so", () => {
    expect(linkOf("https://example.com/page", true)).toBeNull();
    expect(linkOf("https://example.com/a.png?w=200", true)?.name).toBe("a.png");
    expect(linkOf("https://example.com/page", false)?.name).toBe("page");
    expect(linkOf("https://example.com/", false)?.name).toBe("example.com");
  });

  it("is never http, another scheme, or text around a URL", () => {
    expect(linkOf("http://example.com/a.png", true)).toBeNull();
    expect(linkOf("data:image/png;base64,AAAA", false)).toBeNull();
    expect(linkOf("look https://example.com/a.png", true)).toBeNull();
    expect(linkOf("", false)).toBeNull();
  });

  it("is kept as a visual with its source and no media", () => {
    const input = linkVisualInput({ url: "https://x.org/a.png", name: "a.png" }, "lib");
    expect(input).toEqual({
      text: "a.png",
      tags: [GALLERY_IDS.visualTag],
      parent: "lib",
      props: [{ field: GALLERY_IDS.sourceField, value: { t: "str", v: "https://x.org/a.png" } }],
    });
    expect("parent" in linkVisualInput({ url: "https://x.org/a", name: "a" }, null)).toBe(false);
  });
});

describe("the inbox", () => {
  it("holds the visuals with no styles", () => {
    expect(untriagedOf(library).map((v) => v.id)).toEqual(["a", "c"]);
  });

  it("moves on to the next untriaged visual, wrapping, never staying put", () => {
    expect(nextUntriaged(library, "a")).toBe("c");
    expect(nextUntriaged(library, "c")).toBe("a");
    // A visual triaged meanwhile still has a place to move on from.
    expect(nextUntriaged(library, "b")).toBe("c");
    expect(nextUntriaged(library, null)).toBe("a");
    const one = libraryOf([n("only", GALLERY_IDS.visualTag)]);
    expect(nextUntriaged(one, "only")).toBeNull();
  });
});

describe("suggestions by facet", () => {
  it("groups in the order the best of each ranks, the unfiled under none", () => {
    const groups = groupByFacet(library, [
      style("low"),
      style("loose"),
      style("neon"),
      style("golden"),
    ]);
    expect(groups.map((g) => g.facet?.text ?? null)).toEqual(["angle", null, "light"]);
    expect(groups[2]?.styles.map((s) => s.id)).toEqual(["neon", "golden"]);
    expect(groups[0]?.styles[0]?.id).toBe("low");
  });
});
