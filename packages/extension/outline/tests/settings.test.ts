/**
 * The outline family's settings, read off its node (DESIGN-UI.md → "A
 * collapsed parent's halo says it is closed; its count is a setting").
 */
import { describe, expect, test } from "bun:test";
import { extensionNodeId, SYSTEM_IDS, type KbNode } from "@kb/model";
import { EXPORT_DEFAULTS, OUTLINE_FORMATS } from "@kb/outline-paste";
import {
  copyChoiceOf,
  copyChoiceValues,
  OUTLINE_IDS,
  outlineExtension,
  showsChildCounts,
} from "../src/index.ts";

const AT = "2026-11-15T00:00:00.000Z";

describe("show child counts", () => {
  test("is off when the family's node says nothing, or is not there", () => {
    expect(showsChildCounts(undefined)).toBe(false);
    expect(showsChildCounts({ props: {} })).toBe(false);
  });

  test("is what the family's node says", () => {
    const field = OUTLINE_IDS.childCountsField;
    expect(showsChildCounts({ props: { [field]: [{ t: "bool", v: true }] } })).toBe(true);
    expect(showsChildCounts({ props: { [field]: [{ t: "bool", v: false }] } })).toBe(false);
  });

  test("is a checkbox the family seeds, holding one value, that configures its node", () => {
    const seeded = outlineExtension.seed?.(AT) ?? [];
    const field = seeded.find((node) => node.id === OUTLINE_IDS.childCountsField);
    expect(field?.text).toBe("show child counts");
    expect(field?.props[SYSTEM_IDS.fieldTypeField]).toEqual([
      { t: "ref", v: SYSTEM_IDS.ftCheckbox },
    ]);
    expect(field?.props[SYSTEM_IDS.configuresField]).toEqual([
      { t: "ref", v: extensionNodeId("outline") },
    ]);
    expect(field?.props[SYSTEM_IDS.showField]).toBeUndefined();
  });
});

describe("the Copy as… choice", () => {
  const { copy } = OUTLINE_IDS;
  const seeded: readonly KbNode[] = outlineExtension.seed?.(AT) ?? [];
  const byId = new Map(seeded.map((node) => [node.id, node]));

  test("reads as the export defaults while the family's node says nothing", () => {
    expect(copyChoiceOf(undefined)).toEqual(EXPORT_DEFAULTS);
    expect(copyChoiceOf({ props: {} })).toEqual(EXPORT_DEFAULTS);
  });

  test("reads back what it writes, each setting one value", () => {
    const choice = {
      format: "logseq",
      children: false,
      fieldsAndTags: false,
      refs: "link",
      indent: "tabs",
    } as const;
    const props = Object.fromEntries(
      Object.entries(copyChoiceValues(choice)).map(([field, value]) => [field, [value]]),
    );
    expect(copyChoiceOf({ props })).toEqual(choice);
  });

  test("an option it does not know reads as the default", () => {
    const props = { [copy.formatField]: [{ t: "ref" as const, v: "a.persons.own.option" }] };
    expect(copyChoiceOf({ props }).format).toBe(EXPORT_DEFAULTS.format);
  });

  test("its format's options are the formats, in order, each named by its label", () => {
    const field = byId.get(copy.formatField);
    expect(field?.children.map((id) => byId.get(id)?.text)).toEqual(
      OUTLINE_FORMATS.map((format) => format.label),
    );
  });

  test("each setting configures the family's node and holds one value", () => {
    for (const id of Object.values(copy)) {
      const field = byId.get(id);
      expect(field?.props[SYSTEM_IDS.configuresField]).toEqual([
        { t: "ref", v: extensionNodeId("outline") },
      ]);
      expect(field?.props[SYSTEM_IDS.cardinalityField]).toBeDefined();
    }
  });

  test("Copy as… is a command the family seeds, which its Mod-Shift-C runs", () => {
    expect(byId.get(OUTLINE_IDS.copyAsCommand)?.props[SYSTEM_IDS.typeField]).toEqual([
      { t: "ref", v: SYSTEM_IDS.command },
    ]);
    const binding = outlineExtension.keyboard?.bindings?.find(({ id }) => id === "copy-as");
    expect(binding?.value.context).toBe("core.page");
    expect(binding?.value.run).toEqual({ command: OUTLINE_IDS.copyAsCommand });
  });
});
