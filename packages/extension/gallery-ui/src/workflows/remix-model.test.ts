import { describe, expect, it } from "vitest";
import { SYSTEM_IDS, type PropValue } from "@kb/model";
import { EMPTY_LOOK, GALLERY_IDS, libraryOf, type GraphNode } from "@kb/gallery";
import {
  defaultChoices,
  remixDraft,
  remixRows,
  variationGroups,
  type RemixSource,
} from "./remix-model";

const ref = (v: string): PropValue => ({ t: "ref", v });
const n = (id: string, tag: string | null, children: string[] = [], text = id): GraphNode => ({
  id,
  text,
  props: tag === null ? {} : { [SYSTEM_IDS.typeField]: [ref(tag)] },
  children,
});
const library = libraryOf([
  n("styles", null, ["lighting", "palette", "mood"]),
  n("lighting", GALLERY_IDS.facetTag, ["golden", "neon", "noir"], "Lighting"),
  n("golden", GALLERY_IDS.styleTag),
  n("neon", GALLERY_IDS.styleTag),
  n("noir", GALLERY_IDS.styleTag),
  n("palette", GALLERY_IDS.facetTag, ["teal", "warm"], "Palette"),
  n("teal", GALLERY_IDS.styleTag),
  n("warm", GALLERY_IDS.styleTag),
  n("mood", GALLERY_IDS.facetTag, ["calm"], "Mood"),
  n("calm", GALLERY_IDS.styleTag),
]);

const sources: readonly RemixSource[] = [
  { id: "a", kind: "visual", label: "A", styles: ["golden", "warm"] },
  { id: "b", kind: "visual", label: "B", styles: ["neon", "teal"] },
  { id: "l", kind: "look", label: "L", styles: ["noir"] },
];

describe("the remix table", () => {
  it("has a row per axis some source has a style on, in the axes' order", () => {
    const rows = remixRows(library, sources);
    expect(rows.map((r) => r.axis.id)).toEqual(["lighting", "palette"]);
    expect(rows[0]?.cells.map((c) => c.map((s) => s.id))).toEqual([["golden"], ["neon"], ["noir"]]);
    expect(rows[1]?.cells.map((c) => c.map((s) => s.id))).toEqual([["warm"], ["teal"], []]);
  });

  it("chooses, at first, the first source with a style on each axis", () => {
    const rows = remixRows(library, [{ ...sources[2], styles: [] } as RemixSource, ...sources]);
    expect([...defaultChoices(rows)]).toEqual([
      ["lighting", 1],
      ["palette", 1],
    ]);
  });
});

describe("making the look", () => {
  const rows = remixRows(library, sources);

  it("takes the union of the chosen axes' styles and pins the visual sources with what came from each", () => {
    const draft = { ...EMPTY_LOOK, description: "a harbour", styles: ["calm"] };
    const made = remixDraft(
      draft,
      sources,
      rows,
      new Map([
        ["lighting", 0],
        ["palette", 1],
      ]),
    );
    expect(made.description).toBe("a harbour");
    expect(made.styles).toEqual(["golden", "teal"]);
    expect(made.pins).toEqual([
      { id: null, visual: "a", note: "the lighting from here" },
      { id: null, visual: "b", note: "the palette from here" },
    ]);
  });

  it("names every axis taken from one source, takes nothing for an axis left at none, and keeps a pin's node", () => {
    const draft = { ...EMPTY_LOOK, pins: [{ id: "pin1", visual: "a", note: "old" }] };
    const made = remixDraft(
      draft,
      sources,
      rows,
      new Map([
        ["lighting", 0],
        ["palette", 0],
      ]),
    );
    expect(made.styles).toEqual(["golden", "warm"]);
    expect(made.pins[0]).toEqual({
      id: "pin1",
      visual: "a",
      note: "the lighting and the palette from here",
    });
    expect(made.pins[1]).toEqual({ id: null, visual: "b", note: "" });
    expect(remixDraft(draft, sources, rows, new Map()).styles).toEqual([]);
  });
});

describe("varying one axis", () => {
  it("groups the variations by the style swapped", () => {
    const groups = variationGroups(library, ["golden", "teal"]);
    expect(groups.map((g) => g.from.id)).toEqual(["golden", "teal"]);
    expect(groups[0]?.options.map((o) => o.styles)).toEqual([
      ["neon", "teal"],
      ["noir", "teal"],
    ]);
    expect(groups[1]?.options.map((o) => o.to.id)).toEqual(["warm"]);
  });
});
