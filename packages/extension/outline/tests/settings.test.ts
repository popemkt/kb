/**
 * The outline family's settings, read off its node (DESIGN-UI.md → "A
 * collapsed parent's halo says it is closed; its count is a setting").
 */
import { describe, expect, test } from "bun:test";
import { extensionNodeId, SYSTEM_IDS } from "@kb/model";
import { OUTLINE_IDS, outlineExtension, showsChildCounts } from "../src/index.ts";

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
