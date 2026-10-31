/**
 * The starter is an outline the outline parser reads as facets of styles,
 * then the library, whose lines are the ones `node.addTree` answers ids by.
 */
import { describe, expect, test } from "bun:test";
import { parseOutline } from "@kb/model";
import { STARTER_LIBRARY, STARTER_SIZE, starterOutline } from "../src/starter.ts";

describe("the starter", () => {
  test("the starter parses as facets of styles, then the library", () => {
    const outline = starterOutline();
    const parsed = parseOutline(outline.text);
    if (!parsed.ok) throw new Error(`starter outline line ${parsed.line}: ${parsed.reason}`);
    expect(parsed.items.map((item) => item.text)).toEqual(["Styles", STARTER_LIBRARY]);
    const facets = parsed.items[0]?.children ?? [];
    expect(facets.length).toBe(STARTER_SIZE.facets);
    expect(facets.every((facet) => facet.tags.join() === "facet")).toBe(true);
    const styles = facets.flatMap((facet) => facet.children);
    expect(styles.length).toBe(STARTER_SIZE.styles);
    expect(styles.every((style) => style.tags.join() === "style")).toBe(true);
    // Every style name is unique, so a person can add one by name.
    expect(new Set(styles.map((style) => style.text)).size).toBe(styles.length);
    // The lines it names are the lines `node.addTree` answers ids by.
    const lines = outline.text.split("\n");
    expect(lines[outline.library - 1]).toBe(`- ${STARTER_LIBRARY}`);
    for (const [name, line] of outline.styles) expect(lines[line - 1]).toBe(`    - ${name} #style`);
  });
});
