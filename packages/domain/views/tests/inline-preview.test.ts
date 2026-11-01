/**
 * Previews as data (DESIGN.md → View nodes → a tag's view may preview its
 * nodes): a view whose key draws a preview gets settings, derived by the
 * fold as fields configuring its family's node and seeded with their
 * defaults there; they are read off the node those fields configure, so no
 * name is guessed, and a view whose settings the store does not hold has
 * no preview.
 */
import { describe, expect, test } from "bun:test";
import {
  PREVIEW_DEFAULTS,
  SYSTEM_IDS,
  extensionNodeId,
  foldSeed,
  isWritableField,
  present,
  previewSettingIds,
  previewSettingsOf,
  settingsOf,
  type KbNode,
  type NodeProps,
  type SeedSource,
} from "@kb/model";
import { BUNDLED_DECLARATIONS, bundledSeed } from "@kb/bundled";

const AT = "2026-11-01T00:00:00.000Z";
const CANVAS = extensionNodeId("canvas");
const CANVAS_VIEW = "canvas.page";
const ids = previewSettingIds(CANVAS_VIEW);
const seed = bundledSeed(AT);
const byId = new Map(seed.map((node) => [node.id, node]));

/** The canvas family's node with `props` over what the seed gives it. */
function canvasWith(props: NodeProps) {
  const node = present(byId.get(CANVAS), "the seed holds the canvas family's node");
  const graph = new Map<string, { props: NodeProps }>(byId);
  graph.set(CANVAS, { props: { ...node.props, ...props } });
  return (id: string) => graph.get(id);
}

describe("a view's preview settings", () => {
  test("the canvas view's are its family's settings, seeded with their defaults", () => {
    const settings = settingsOf(seed, (id) => byId.get(id), CANVAS).map(({ field, label }) => [
      field,
      label,
    ]);
    expect(settings).toEqual([
      [ids.shows, "previews"],
      [ids.expanded, "previews open"],
      [ids.height, "preview height"],
    ]);
    expect(previewSettingsOf(CANVAS_VIEW, (id) => byId.get(id))).toEqual(PREVIEW_DEFAULTS);
    expect(byId.get(CANVAS)?.props[ids.height]).toEqual([{ t: "num", v: PREVIEW_DEFAULTS.height }]);
  });

  test("a view that draws no preview has none, and reads as no preview at all", () => {
    expect(byId.has(previewSettingIds("outline.main").shows)).toBe(false);
    expect(previewSettingsOf("outline.main", (id) => byId.get(id))).toBeNull();
  });

  test("they are a person's to write on the family's node, and on no other", () => {
    const field = byId.get(ids.height);
    expect(isWritableField({ id: CANVAS }, ids.height, field)).toBe(true);
    expect(isWritableField({ id: extensionNodeId("graph") }, ids.height, field)).toBe(false);
  });

  test("what a person writes is read, the height held between 60 and 600", () => {
    const read = (height: number) =>
      present(
        previewSettingsOf(
          CANVAS_VIEW,
          canvasWith({
            [ids.shows]: [{ t: "bool", v: false }],
            [ids.expanded]: [{ t: "bool", v: true }],
            [ids.height]: [{ t: "num", v: height }],
          }),
        ),
        "the canvas view's settings",
      );
    expect(read(240)).toEqual({ shows: false, expanded: true, height: 240 });
    expect(read(5).height).toBe(60);
    expect(read(5000).height).toBe(600);
  });
});

/** A source providing one view, `previews` or not, whose family is `name`. */
function source(name: string, previews: boolean): SeedSource {
  return {
    name,
    label: name,
    views: [{ key: { id: `${name}.page`, label: name, preview: previews } }],
    seed: (): KbNode[] => [],
  };
}

describe("the fold derives them from the view's key", () => {
  const core = BUNDLED_DECLARATIONS.filter((declaration) => declaration.name === "core");

  test("a previewing view's settings configure the node of the family that provides it", () => {
    const folded = new Map(
      foldSeed([...core, source("boards", true)], AT).nodes.map((n) => [n.id, n]),
    );
    const field = present(folded.get(previewSettingIds("boards.page").shows), "derived");
    expect(field.props[SYSTEM_IDS.configuresField]).toEqual([
      { t: "ref", v: extensionNodeId("boards") },
    ]);
    expect(previewSettingsOf("boards.page", (id) => folded.get(id))).toEqual(PREVIEW_DEFAULTS);
  });

  test("a view that does not preview gets none", () => {
    const folded = new Map(
      foldSeed([...core, source("boards", false)], AT).nodes.map((n) => [n.id, n]),
    );
    expect(folded.has(previewSettingIds("boards.page").shows)).toBe(false);
    expect(folded.get(extensionNodeId("boards"))?.props).toEqual({});
  });
});
