/**
 * The gallery family owns its vocabulary: its declaration lists the library
 * page and seeds its tags, fields and sources, every name of which resolves
 * to one node in a bundled store, and its starter is an outline the outline
 * parser reads as facets of styles.
 */
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { BUNDLED_DECLARATIONS, bundledSeed } from "@kb/bundled";
import { ViewKeyPoint } from "@kb/contracts";
import { SYSTEM_IDS, parseOutline, type KbNode } from "@kb/model";
import { makeKernel } from "@kb/plugin";
import {
  GALLERY_IDS,
  GALLERY_SOURCE_IDS,
  GALLERY_WORKFLOWS,
  GalleryView,
  STARTER_SIZE,
  galleryExtension,
  galleryPlugin,
  starterOutline,
} from "@kb/gallery";
import { STARTER_LIBRARY } from "../src/starter.ts";

const AT = "2026-01-01T00:00:00.000Z";

function contributed() {
  return Effect.runSync(
    Effect.gen(function* () {
      const kernel = makeKernel();
      yield* kernel.load(galleryPlugin());
      const views = kernel.contributions(ViewKeyPoint).map(({ id }) => id);
      yield* kernel.shutdown;
      return views;
    }),
  );
}

const isKind = (node: KbNode, kind: string) =>
  node.props[SYSTEM_IDS.typeField]?.some((v) => v.t === "ref" && v.v === kind) ?? false;

describe("gallery family", () => {
  test("its declaration lists the composer page and its workflows, off by default", () => {
    const keys = [GalleryView, ...GALLERY_WORKFLOWS];
    expect(galleryExtension.views?.map((view) => view.key)).toEqual(keys);
    expect(galleryExtension.optional).toEqual({ byDefault: "off" });
    expect(BUNDLED_DECLARATIONS).toContain(galleryExtension);
    expect(GalleryView.id).toBe("gallery.library");
    expect(galleryPlugin().name).toBe(galleryExtension.name);
    expect(contributed()).toEqual(keys.map((key) => key.id));
  });

  test("the bundled seed holds its tags, fields and sources", () => {
    const seed = bundledSeed(AT);
    const ids = new Set(seed.map((node) => node.id));
    for (const id of Object.values(GALLERY_IDS)) expect(ids.has(id)).toBe(true);
    for (const id of Object.values(GALLERY_SOURCE_IDS)) {
      const source = seed.find((node) => node.id === id);
      expect(source !== undefined && isKind(source, GALLERY_IDS.sourceTag)).toBe(true);
      const url = source?.props[GALLERY_IDS.searchUrlField]?.[0];
      expect(url?.t === "str" && url.v.startsWith("https://") && url.v.includes("{query}")).toBe(
        true,
      );
    }
  });

  test("every tag and field it seeds is the only one of its name, so names resolve", () => {
    const seed = bundledSeed(AT);
    for (const kind of [SYSTEM_IDS.tag, SYSTEM_IDS.field]) {
      const named = seed.filter((node) => isKind(node, kind));
      for (const own of named.filter((node) =>
        Object.values(GALLERY_IDS).some((id) => id === node.id),
      ))
        expect(named.filter((node) => node.text === own.text).map((node) => node.id)).toEqual([
          own.id,
        ]);
    }
  });

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
