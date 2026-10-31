/**
 * Inline previews (DESIGN.md → View nodes → inline previews): a family that
 * declares `inlinePreview` gets three settings, derived by the fold as
 * fields configuring its node and seeded with their defaults there; reading
 * them falls back to the defaults and holds the height in bounds; a node's
 * own toggle opens or closes its preview, and the family's settings decide
 * the rest.
 */
import { describe, expect, test } from "bun:test";
import {
  PREVIEW_DEFAULTS,
  SYSTEM_IDS,
  extensionNodeId,
  isWritableField,
  present,
  previewSettingIds,
  previewSettingsOf,
  previewShownOf,
  settingsOf,
  type NodeProps,
} from "@kb/model";
import { bundledSeed } from "@kb/bundled";

const AT = "2026-10-31T00:00:00.000Z";
const CANVAS = extensionNodeId("canvas");
const ids = previewSettingIds("canvas");
const seed = bundledSeed(AT);
const byId = new Map(seed.map((node) => [node.id, node]));

/** The family's node with `props` over what the seed gives it. */
function canvasWith(props: NodeProps) {
  const node = present(byId.get(CANVAS), "the seed holds the canvas family's node");
  const graph = new Map<string, { props: NodeProps }>(byId);
  graph.set(CANVAS, { props: { ...node.props, ...props } });
  return (id: string) => graph.get(id);
}

describe("a family's preview settings", () => {
  test("the canvas family's are its settings, seeded with their defaults", () => {
    const settings = settingsOf(seed, (id) => byId.get(id), CANVAS).map(({ field, label }) => [
      field,
      label,
    ]);
    expect(settings).toEqual([
      [ids.shows, "previews"],
      [ids.expanded, "previews open"],
      [ids.height, "preview height"],
    ]);
    expect(previewSettingsOf("canvas", (id) => byId.get(id))).toEqual(PREVIEW_DEFAULTS);
    expect(byId.get(CANVAS)?.props[ids.height]).toEqual([{ t: "num", v: PREVIEW_DEFAULTS.height }]);
  });

  test("a family that draws no preview has none, and reads as the defaults", () => {
    expect(settingsOf(seed, (id) => byId.get(id), extensionNodeId("graph"))).not.toContainEqual(
      expect.objectContaining({ field: previewSettingIds("graph").shows }),
    );
    expect(previewSettingsOf("graph", (id) => byId.get(id))).toEqual(PREVIEW_DEFAULTS);
  });

  test("they are a person's to write on the family's node, and on no other", () => {
    const field = byId.get(ids.height);
    expect(isWritableField({ id: CANVAS }, ids.height, field)).toBe(true);
    expect(isWritableField({ id: extensionNodeId("graph") }, ids.height, field)).toBe(false);
  });

  test("what a person writes is read, the height held between 60 and 600", () => {
    const read = (height: number) =>
      previewSettingsOf(
        "canvas",
        canvasWith({
          [ids.shows]: [{ t: "bool", v: false }],
          [ids.expanded]: [{ t: "bool", v: true }],
          [ids.height]: [{ t: "num", v: height }],
        }),
      );
    expect(read(240)).toEqual({ shows: false, expanded: true, height: 240 });
    expect(read(5).height).toBe(60);
    expect(read(5000).height).toBe(600);
  });
});

/** A node whose own toggle says `v`. */
const toggled = (v: boolean) => ({
  props: { [SYSTEM_IDS.previewField]: [{ t: "bool" as const, v }] },
});

describe("whether a node's preview is open", () => {
  const untouched = { props: {} };

  test("its own toggle decides, else its family's `expanded`", () => {
    expect(previewShownOf(untouched, PREVIEW_DEFAULTS)).toBe(false);
    expect(previewShownOf(toggled(true), PREVIEW_DEFAULTS)).toBe(true);
    const open = { ...PREVIEW_DEFAULTS, expanded: true };
    expect(previewShownOf(untouched, open)).toBe(true);
    expect(previewShownOf(toggled(false), open)).toBe(false);
  });

  test("a family that shows no previews shows none, whatever a node says", () => {
    expect(previewShownOf(toggled(true), { ...PREVIEW_DEFAULTS, shows: false })).toBe(false);
  });
});
