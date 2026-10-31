/**
 * The starter is an outline the outline parser reads as facets of styles,
 * then the library, whose lines are the ones `node.addTree` answers ids by.
 */
import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS, parseOutline, type OutlineItem } from "@kb/model";
import { galleryExtension } from "@kb/gallery";
import { NOTES_3D } from "../src/starter-3d.ts";
import { STARTER_LIBRARY, starterOutline } from "../src/starter.ts";

const AT = "2026-01-01T00:00:00.000Z";

function stylesOf(): readonly OutlineItem[] {
  const parsed = parseOutline(starterOutline().text);
  if (!parsed.ok) throw new Error(`starter outline line ${parsed.line}: ${parsed.reason}`);
  return (parsed.items[0]?.children ?? []).flatMap((facet) => facet.children);
}

describe("the starter", () => {
  test("the starter parses as facets of styles, then the library", () => {
    const outline = starterOutline();
    const parsed = parseOutline(outline.text);
    if (!parsed.ok) throw new Error(`starter outline line ${parsed.line}: ${parsed.reason}`);
    expect(parsed.items.map((item) => item.text)).toEqual(["Styles", STARTER_LIBRARY]);
    const facets = parsed.items[0]?.children ?? [];
    expect(facets.map((facet) => facet.text)).toContain("3D style");
    expect(facets.every((facet) => facet.tags.join() === "facet")).toBe(true);
    const styles = facets.flatMap((facet) => facet.children);
    expect(styles.length).toBe(outline.styles.size);
    expect(styles.every((style) => style.tags.join() === "style")).toBe(true);
    // Every style name is unique, so a person can add one by name.
    expect(new Set(styles.map((style) => style.text)).size).toBe(styles.length);
    // The lines it names are the lines `node.addTree` answers ids by.
    const lines = outline.text.split("\n");
    expect(lines[outline.library - 1]).toBe(`- ${STARTER_LIBRARY}`);
    for (const [name, line] of outline.styles) expect(lines[line - 1]).toBe(`    - ${name} #style`);
  });

  test("a style's notes are fields the gallery seeds, and what it is made with names the starter's", () => {
    const styles = stylesOf();
    const fields = new Set(
      (galleryExtension.seed?.(AT) ?? [])
        .filter(
          (node) =>
            node.props[SYSTEM_IDS.typeField]?.some(
              (v) => v.t === "ref" && v.v === SYSTEM_IDS.field,
            ) === true,
        )
        .map((node) => node.text),
    );
    const names = new Set(styles.map((style) => style.text));
    const noted = styles.filter((style) => style.fields.length > 0);
    expect(noted.length).toBeGreaterThan(80);
    for (const style of noted)
      for (const field of style.fields) {
        expect(fields.has(field.name)).toBe(true);
        if (field.name !== "made with") continue;
        for (const value of field.values)
          expect(names.has(value.raw.replace(/^\[\[(.*)\]\]$/, "$1"))).toBe(true);
      }
  });

  test("every note for a style named by name only reaches that style", () => {
    const byName = new Map(stylesOf().map((style) => [style.text, style]));
    for (const [name, notes] of Object.entries(NOTES_3D)) {
      const fields = byName.get(name)?.fields.map((field) => field.name) ?? [];
      expect({ name, fields }).toEqual({
        name,
        fields: expect.arrayContaining(
          notes.description === undefined ? ["how to"] : ["description", "how to"],
        ),
      });
    }
  });

  test("a 3D style is made with techniques the starter names, and prompts name no work", () => {
    const style = stylesOf().find((item) => item.text === "cel-shaded");
    const made = style?.fields
      .find((field) => field.name === "made with")
      ?.values.map((v) => v.raw);
    expect(made).toContain("[[toon ramp]]");
    expect(made).toContain("[[inverted hull outline]]");
    const how = style?.fields.find((field) => field.name === "how to")?.values ?? [];
    expect(how.map((v) => v.raw.split(":")[0])).toEqual(["Three.js", "Blender"]);
    for (const item of stylesOf())
      for (const value of item.fields.find((field) => field.name === "prompt")?.values ?? [])
        expect(value.raw).toContain("{prompt}");
  });
});
