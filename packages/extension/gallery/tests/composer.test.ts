/**
 * The composer's readings: a look read from and written back to nodes, its
 * prompts read (never stored), its brief, its palette; and the readings
 * that articulate an idea — axes over the library's facets, the model's
 * reflection read back into chips, either/or pairs, kinship and variations.
 */
import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS, type PropValue } from "@kb/model";
import {
  EMPTY_LOOK,
  GALLERY_IDS,
  GALLERY_WORKFLOWS,
  axesOf,
  briefOf,
  chipsFor,
  eitherOrs,
  examplesOf,
  isWorkflowKey,
  libraryOf,
  lookOf,
  lookWrites,
  moreLike,
  paletteOf,
  parseReflection,
  promptsOf,
  reflectInput,
  variationsOf,
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
const style = (id: string, text: string) => n(id, text, tag(GALLERY_IDS.styleTag));
const visual = (id: string, styles: string[]) =>
  n(id, `visual ${id}`, {
    ...tag(GALLERY_IDS.visualTag),
    [GALLERY_IDS.stylesField]: styles.map(ref),
    [GALLERY_IDS.mediaField]: [str(`![${id}](assets/${id}.webp)`)],
  });

const NODES: GraphNode[] = [
  n("styles", "Styles", {}, ["lighting", "palette", "shot", "props"]),
  facet("lighting", "Lighting", ["golden", "blue", "neon", "candle"]),
  style("golden", "golden hour"),
  style("blue", "blue hour"),
  style("neon", "neon lighting"),
  style("candle", "candlelight"),
  facet("palette", "Palette", ["pastel", "earth"]),
  style("pastel", "pastel palette"),
  style("earth", "muted earth tones"),
  facet("shot", "Shot size", ["close", "wide"]),
  style("close", "close-up"),
  style("wide", "wide shot"),
  facet("props", "Props", ["umbrella"]),
  style("umbrella", "red umbrella"),
  visual("v1", ["golden", "close"]),
  visual("v2", ["golden", "close", "pastel"]),
  visual("v3", ["neon", "wide"]),
  visual("v4", ["golden"]),
];
const library = libraryOf(NODES);
const byId = new Map(NODES.map((node) => [node.id, node]));
const get = (id: string) => byId.get(id);

describe("workflows are views of one family", () => {
  test("every gallery workflow's key is a workflow key that opens the composer on itself", () => {
    for (const key of GALLERY_WORKFLOWS) {
      expect(isWorkflowKey(key)).toBe(true);
      const page = key.page?.({ host: null, viewNode: null });
      expect(page?.input).toEqual({ workflow: key.id.slice("gallery.".length) });
    }
    expect(new Set(GALLERY_WORKFLOWS.map((k) => k.workflow.question)).size).toBe(
      GALLERY_WORKFLOWS.length,
    );
  });
});

describe("a look", () => {
  const draft: LookDraft = {
    ...EMPTY_LOOK,
    description: "a lighthouse on a cliff, lonely",
    styles: ["close", "golden"],
    negative: "people",
    palette: ["#112233"],
    pins: [{ id: null, visual: "v1", note: "the light from here" }],
  };

  test("composes a prompt per model family in facet order, with a negative only where it is read", () => {
    const prompts = promptsOf(draft, library);
    const sd = prompts.find((p) => p.target === "sd");
    expect(sd?.positive).toBe("a lighthouse on a cliff, lonely, golden hour, close-up");
    expect(sd?.negative).toBe("people");
    expect(prompts.find((p) => p.target === "flux")?.negative).toBe("");
  });

  test("a new look is one add, tagged, under the parent, named by its brief", () => {
    const writes = lookWrites(draft, null, "lib");
    expect(writes).toHaveLength(1);
    const [add] = writes;
    expect(add?.id).toBe("node.add");
    if (add?.id !== "node.add") return;
    expect(add.input.text).toBe("a lighthouse on a cliff, lonely");
    expect(add.input.parent).toBe("lib");
    expect(add.input.tags).toEqual([GALLERY_IDS.lookTag]);
    expect(add.input.props.filter((p) => p.field === GALLERY_IDS.stylesField)).toHaveLength(2);
  });

  test("once the look is saved, what is left is its pins", () => {
    const saved = { ...draft, id: "L", pins: [] };
    const writes = lookWrites({ ...draft, id: "L" }, saved, "lib");
    expect(writes).toEqual([
      {
        id: "node.add",
        pin: 0,
        input: {
          text: "the light from here",
          parent: "L",
          props: [{ field: GALLERY_IDS.referenceField, value: { t: "ref", v: "v1" } }],
        },
      },
    ]);
  });

  test("reads back from nodes, and an edit writes only what changed", () => {
    const look = n(
      "L",
      "Lighthouse",
      {
        ...tag(GALLERY_IDS.lookTag),
        [GALLERY_IDS.descriptionField]: [str("a lighthouse")],
        [GALLERY_IDS.stylesField]: [ref("golden")],
      },
      ["p1", "p2"],
    );
    const p1 = n("p1", "light", { [GALLERY_IDS.referenceField]: [ref("v1")] });
    const p2 = n("p2", "palette", { [GALLERY_IDS.referenceField]: [ref("v2")] });
    const nodes = new Map([look, p1, p2].map((x) => [x.id, x]));
    const saved = lookOf(look, (id) => nodes.get(id));
    expect(saved.pins.map((p) => p.note)).toEqual(["light", "palette"]);
    expect(lookWrites(saved, saved, null)).toEqual([]);
    const [first] = saved.pins;
    if (first === undefined) throw new Error("no pin read back");
    const edited = { ...saved, pins: [{ ...first, note: "the light" }] };
    expect(lookWrites(edited, saved, null)).toEqual([
      { id: "node.delete", input: { id: "p2" } },
      { id: "node.update", input: { id: "p1", text: "the light" } },
    ]);
  });

  test("its brief names its styles by facet, its prompts and its references", () => {
    const brief = briefOf(draft, library, get);
    expect(brief).toContain("- **Lighting**: golden hour");
    expect(brief).toContain("- **Shot size**: close-up");
    expect(brief).toContain("**FLUX**");
    expect(brief).toContain("visual v1 — the light from here");
    expect(brief).toContain("![visual v1](assets/v1.webp)");
  });
});

const px = (r: number, g: number, b: number, a = 255) => [r, g, b, a];

describe("the palette", () => {
  test("is the dominant colours of the pixels, the largest first, transparent ones ignored", () => {
    const rgba = new Uint8ClampedArray([
      ...Array.from({ length: 6 }, () => px(250, 0, 0)).flat(),
      ...Array.from({ length: 2 }, () => px(0, 0, 250)).flat(),
      ...px(0, 255, 0, 0),
    ]);
    expect(paletteOf(rgba, 2)).toEqual(["#fa0000", "#0000fa"]);
    expect(paletteOf(new Uint8ClampedArray(), 4)).toEqual([]);
  });
});

describe("articulating an idea", () => {
  test("axes read the library's facets by name, and a facet no axis names is its own", () => {
    const axes = axesOf(library);
    expect(axes.find((a) => a.id === "lighting")?.facets).toEqual(["lighting"]);
    expect(axes.find((a) => a.id === "composition")?.facets).toEqual(["shot"]);
    expect(axes.at(-1)).toEqual({ id: "props", label: "Props", facets: ["props"] });
  });

  test("the request shows the model the library's names, and says when pictures go with it", () => {
    const { system, message } = reflectInput("a lonely lighthouse", library, 2);
    expect(system).toContain(
      "- lighting (Lighting): golden hour; blue hour; neon lighting; candlelight",
    );
    expect(message).toContain("2 reference pictures are attached");
  });

  test("a reply is read back, fenced or not, and its terms match styles by name", () => {
    const reply =
      'Sure:\n```json\n{"description": "a lighthouse at dusk", "axes": {"lighting": ["Golden hour", "god rays"], "mood": "x"}}\n```';
    const reflection = parseReflection(reply);
    expect(reflection?.description).toBe("a lighthouse at dusk");
    expect(reflection?.axes.has("mood")).toBe(false);
    const lighting = axesOf(library).find((a) => a.id === "lighting");
    if (lighting === undefined) throw new Error("no lighting axis");
    expect(chipsFor(library, lighting, reflection?.axes.get("lighting") ?? [])).toEqual([
      { text: "Golden hour", style: "golden", facet: "lighting" },
      { text: "god rays", style: null, facet: "lighting" },
    ]);
    expect(parseReflection("no json here")).toBeNull();
  });

  test("either/or offers two styles of an axis the look has nothing in, and moves on by round", () => {
    const first = eitherOrs(library, new Set(["golden"]), 0);
    expect(first.map((c) => c.axis.id)).toEqual(["palette", "composition", "props"].slice(0, 2));
    expect(first[0]?.pair.map((s) => s.text)).toEqual(["pastel palette", "muted earth tones"]);
    const lighting = eitherOrs(library, new Set(), 1).find((c) => c.axis.id === "lighting");
    expect(lighting?.pair.map((s) => s.id)).toEqual(["blue", "candle"]);
  });

  test("more like this ranks by shared styles; variations swap a style for a sibling", () => {
    expect(moreLike(library, "v1")).toEqual(["v2", "v4"]);
    const variations = variationsOf(library, ["golden", "close"]);
    expect(variations.map((v) => `${v.from.text}→${v.to.text}`)).toEqual([
      "golden hour→blue hour",
      "golden hour→neon lighting",
      "golden hour→candlelight",
      "close-up→wide shot",
    ]);
    expect(variations[0]?.styles).toEqual(["blue", "close"]);
    expect(examplesOf(library).get("pastel")).toBe("v2");
  });
});
