/**
 * The gallery family's declaration and its shared plugin (DESIGN.md →
 * Extension families). The declaration is the one home of the family's name,
 * seed and views (the composer page and its workflows); the bundled seed
 * folds it, and both hosts load {@link galleryPlugin}, so a key cannot
 * differ between them. It is optional and off by default: a person switches
 * the gallery on.
 */
import { declarationPlugin, defineExtension, viewDef } from "@kb/contracts";
import type { Plugin } from "@kb/plugin";
import { gallerySeedNodes } from "./seed.ts";
import { GALLERY_WORKFLOWS, GalleryView } from "./view.ts";

export const galleryExtension = defineExtension({
  name: "gallery",
  label: "Gallery",
  tags: ["gallery"],
  optional: { byDefault: "off" },
  seed: gallerySeedNodes,
  views: [viewDef(GalleryView), ...GALLERY_WORKFLOWS.map((key) => viewDef(key))],
});

/**
 * The gallery family's shared plugin: its declaration's view. The server's
 * entry (`@kb/gallery-net`) and the page's entry each load it as a child.
 */
export function galleryPlugin(): Plugin {
  return declarationPlugin(galleryExtension);
}
