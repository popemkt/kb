import { Effect } from "effect";
import { familyTags } from "@kb/contracts";
import { definePlugin } from "@kb/plugin";
import { GalleryView, galleryExtension, galleryPlugin } from "@kb/gallery";
import {
  BrowserHostService,
  provideRoute,
  provideView,
  RoutePoint,
  SidebarSectionPoint,
  ViewPoint,
} from "@kb/ui-sdk";
import { galleryEnhancePlugin } from "./enhance";
import { matchGallery, GALLERY_PATH } from "./routes";
import { GallerySection, GallerySurface } from "./surfaces";

/**
 * The gallery: a library of visual references (styles, shots, motions,
 * palettes, artists), browsed by facet, composed into prompts, and fed from
 * online sources. Optional and off by default: the page loads this entry
 * only while the server reports the gallery switched on (`ui-plugins.ts`),
 * so its view, its route and its sidebar row exist only then.
 *
 * It is the gallery family's page entry, so it loads the family's shared
 * plugin as a child: the gallery view's key reaches the page kernel's
 * catalog from the family, as the server's does. Its `enhance` child
 * injects the page's model completion, so the composer's Enhance waits
 * while no family provides one and the gallery does not (`enhance.ts`).
 */
export const galleryUiPlugin = definePlugin({
  name: galleryExtension.name,
  tags: familyTags(galleryExtension, "ui"),
  inject: [BrowserHostService],
  apply: (ctx) =>
    Effect.all(
      [
        ctx.plugin(galleryPlugin()),
        ctx.plugin(galleryEnhancePlugin),
        ctx.contribute(
          ViewPoint,
          provideView(GalleryView, {
            placements: ["page"],
            sample: {},
            Component: GallerySurface,
          }),
        ),
        ctx.contribute(
          RoutePoint,
          provideRoute({
            view: GalleryView,
            match: matchGallery,
            entry: GALLERY_PATH,
            frame: () => "full",
            pendingTitle: () => "Opening the gallery…",
          }),
        ),
        ctx.contribute(SidebarSectionPoint, {
          id: "section",
          value: { order: 35, Component: GallerySection },
        }),
      ],
      { discard: true },
    ),
});
