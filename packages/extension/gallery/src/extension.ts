/**
 * The gallery family's declaration and its shared plugin (DESIGN.md →
 * Extension families). The declaration is the one home of the family's name,
 * seed and view; the bundled seed folds it, and both hosts load
 * {@link galleryPlugin}, so the key cannot differ between them. It is
 * optional and off by default: a person switches the library on.
 */
import { declarationPlugin, defineExtension, viewDef } from "@kb/contracts";
import type { Plugin } from "@kb/plugin";
import { gallerySeedNodes } from "./seed.ts";
import { GalleryView } from "./view.ts";

export const galleryExtension = defineExtension({
  name: "gallery",
  label: "Gallery",
  tags: ["gallery"],
  optional: { byDefault: "off" },
  seed: gallerySeedNodes,
  views: [viewDef(GalleryView)],
});

/**
 * The gallery family's shared plugin: its declaration's view. The server's
 * entry (`@kb/gallery-net`) and the page's entry each load it as a child.
 */
export function galleryPlugin(): Plugin {
  return declarationPlugin(galleryExtension);
}
