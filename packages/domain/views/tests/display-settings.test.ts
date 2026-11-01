/**
 * Display settings as data (DESIGN.md → View nodes → a tag's view sets how
 * its nodes show): a view a family claims as a tag's default view gets one
 * setting per display option it offers — "when a node asks" or "always" —
 * and, where it previews, the preview's height, derived by the fold as
 * fields configuring the family's node and seeded with their defaults
 * there. They are read off the node those fields configure, so no name is
 * guessed, and settings the store does not hold read as the defaults.
 */
import { describe, expect, test } from "bun:test";
import {
  DISPLAY_DEFAULTS,
  SYSTEM_IDS,
  displayDefaultId,
  displaySettingIds,
  displaySettingsOf,
  extensionNodeId,
  foldSeed,
  isWritableField,
  present,
  settingsOf,
  type KbNode,
  type NodeProps,
  type SeedSource,
  type SeedView,
} from "@kb/model";
import { BUNDLED_DECLARATIONS, bundledSeed } from "@kb/bundled";

const AT = "2026-11-01T00:00:00.000Z";
const CANVAS = extensionNodeId("canvas");
const CANVAS_VIEW = "canvas.page";
const ids = displaySettingIds(CANVAS_VIEW);
const seed = bundledSeed(AT);
const byId = new Map(seed.map((node) => [node.id, node]));
const read = (id: string) => byId.get(id);

/** The canvas family's node with `props` over what the seed gives it. */
function canvasWith(props: NodeProps) {
  const node = present(byId.get(CANVAS), "the seed holds the canvas family's node");
  const graph = new Map<string, { props: NodeProps }>(byId);
  graph.set(CANVAS, { props: { ...node.props, ...props } });
  return (id: string) => graph.get(id);
}

describe("a view's display settings", () => {
  test("the canvas view's are its family's settings, seeded with their defaults", () => {
    const settings = settingsOf(seed, read, CANVAS).map(({ field, label }) => [field, label]);
    expect(settings).toEqual([
      [ids.preview, "inline preview"],
      [ids.height, "preview height"],
      [ids.properties, "properties"],
    ]);
    expect(displaySettingsOf(CANVAS_VIEW, read)).toEqual(DISPLAY_DEFAULTS);
    expect(byId.get(CANVAS)?.props[ids.preview]).toEqual([
      { t: "ref", v: displayDefaultId(ids.preview, "asked") },
    ]);
  });

  test("each option's values are its field's children: when a node asks, or always", () => {
    expect(byId.get(ids.properties)?.children).toEqual([
      displayDefaultId(ids.properties, "asked"),
      displayDefaultId(ids.properties, "always"),
    ]);
    expect(byId.get(displayDefaultId(ids.properties, "always"))?.text).toBe("always");
  });

  test("a view no family claims for a tag has none, and reads as the defaults", () => {
    expect(byId.has(displaySettingIds("outline.main").properties)).toBe(false);
    expect(displaySettingsOf("outline.main", read)).toEqual(DISPLAY_DEFAULTS);
  });

  test("they are a person's to write on the family's node, and on no other", () => {
    const field = byId.get(ids.properties);
    expect(isWritableField({ id: CANVAS }, ids.properties, field)).toBe(true);
    expect(isWritableField({ id: extensionNodeId("graph") }, ids.properties, field)).toBe(false);
  });

  test("what a person writes is read, the height held between 60 and 600", () => {
    const settings = (height: number) =>
      displaySettingsOf(
        CANVAS_VIEW,
        canvasWith({
          [ids.properties]: [{ t: "ref", v: displayDefaultId(ids.properties, "always") }],
          [ids.height]: [{ t: "num", v: height }],
        }),
      );
    expect(settings(240)).toEqual({ preview: "asked", properties: "always", height: 240 });
    expect(settings(5).height).toBe(60);
    expect(settings(5000).height).toBe(600);
  });

  test("a value that is no option of its field reads as the default", () => {
    const settings = displaySettingsOf(
      CANVAS_VIEW,
      canvasWith({ [ids.preview]: [{ t: "ref", v: displayDefaultId(ids.properties, "always") }] }),
    );
    expect(settings.preview).toBe("asked");
  });
});

/** A source whose family is `name`, providing one view, `previews` or not, claimed for a tag when `claims`. */
function source(name: string, previews: boolean, claims: boolean): SeedSource {
  const view: SeedView = { id: `${name}.page`, label: name, preview: previews };
  const tag: KbNode = {
    id: `sys.tag.${name}`,
    text: name,
    props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }] },
    children: [],
    createdAt: AT,
    updatedAt: AT,
  };
  return {
    name,
    label: name,
    views: [{ key: view }],
    seed: () => [tag],
    ...(claims ? { tagDefaultViews: { [tag.id]: view } } : {}),
  };
}

describe("the fold derives them from the views a family claims for a tag", () => {
  const core = BUNDLED_DECLARATIONS.filter((declaration) => declaration.name === "core");
  const fold = (of: SeedSource) =>
    new Map(foldSeed([...core, of], AT).nodes.map((node) => [node.id, node]));

  test("a claimed view's settings configure the node of the family that provides it", () => {
    const folded = fold(source("boards", true, true));
    const field = present(folded.get(displaySettingIds("boards.page").preview), "derived");
    expect(field.props[SYSTEM_IDS.configuresField]).toEqual([
      { t: "ref", v: extensionNodeId("boards") },
    ]);
    expect(displaySettingsOf("boards.page", (id) => folded.get(id))).toEqual(DISPLAY_DEFAULTS);
  });

  test("a claimed view that draws no preview offers only its properties", () => {
    const folded = fold(source("boards", false, true));
    const settings = displaySettingIds("boards.page");
    expect(folded.has(settings.properties)).toBe(true);
    expect(folded.has(settings.preview)).toBe(false);
    expect(folded.has(settings.height)).toBe(false);
  });

  test("a view no tag is claimed for gets none", () => {
    const folded = fold(source("boards", true, false));
    expect(folded.has(displaySettingIds("boards.page").properties)).toBe(false);
    expect(folded.get(extensionNodeId("boards"))?.props).toEqual({});
  });
});
