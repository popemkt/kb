/**
 * The gallery family owns its vocabulary: its declaration lists the library
 * page and seeds its tags, fields and sources, every name of which resolves
 * to one node in a bundled store.
 */
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { BUNDLED_DECLARATIONS, bundledSeed } from "@kb/bundled";
import { ViewKeyPoint } from "@kb/contracts";
import { SYSTEM_IDS, type KbNode } from "@kb/model";
import { makeKernel } from "@kb/plugin";
import {
  GALLERY_IDS,
  GALLERY_SOURCE_IDS,
  GALLERY_WORKFLOWS,
  GalleryView,
  galleryExtension,
  galleryPlugin,
} from "@kb/gallery";

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
});
