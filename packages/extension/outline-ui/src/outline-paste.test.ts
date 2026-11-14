/**
 * What the outline claims of a paste (DESIGN-UI.md → Paste and drop): a
 * list, as outline paste text; never prose.
 */
import { describe, expect, it } from "vitest";
import { parseOutline } from "@kb/outline-paste";
import { outlineOfList, PASTED_LIST } from "./outline-paste";

const claims = (text: string) => new RegExp(PASTED_LIST, "u").test(text);

describe("a pasted list", () => {
  it("is two or more list items, nesting by indent, blank lines between allowed", () => {
    expect(claims("- one\n- two")).toBe(true);
    expect(claims("- one\n  - nested\n- two\n")).toBe(true);
    expect(claims("* one\r\n* two\r\n")).toBe(true);
    expect(claims("+ one\n\n+ two")).toBe(true);
    expect(claims("%%tana%%\n- one\n  - status:: done\n- two")).toBe(true);
    expect(claims("- one\n-\n- three")).toBe(true);
  });

  it("is not one item, prose, or a list with prose in it", () => {
    expect(claims("- one")).toBe(false);
    expect(claims("one\ntwo")).toBe(false);
    expect(claims("Issue #12\nis fixed")).toBe(false);
    expect(claims("- one\nand then\n- two")).toBe(false);
    expect(claims("-one\n-two")).toBe(false);
    expect(claims("1. one\n2. two")).toBe(false);
    expect(claims("")).toBe(false);
  });

  it("reads as outline paste, every marker a dash", () => {
    const outline = outlineOfList("* one\r\n  + nested\r\n* two");
    expect(outline).toBe("- one\n  - nested\n- two");
    const parsed = parseOutline(outline);
    expect(parsed.ok && parsed.items.map(({ text, children }) => [text, children.length])).toEqual([
      ["one", 1],
      ["two", 0],
    ]);
  });
});
