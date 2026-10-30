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
import { galleryModelPlugin } from "./model";
import { galleryMoodboardPlugin } from "./moodboard";
import { GALLERY_WORKFLOW_SURFACES } from "./workflows";
import { matchGallery, GALLERY_PATH } from "./routes";
import { GallerySection, GallerySurface } from "./surfaces";

/**
 * The gallery: a visual composer over a library of references (styles,
 * shots, motions, palettes, artists), with workflows for each way in and a
 * look as what they make. Optional and off by default: the page loads this
 * entry only while the server reports the gallery switched on
 * (`ui-plugins.ts`), so its views, its route and its sidebar row exist only
 * then.
 *
 * It is the gallery family's page entry, so it loads the family's shared
 * plugin as a child: the views' keys reach the page kernel's catalog from
 * the family, as the server's do. Its `model` child injects the page's
 * model completion and its `moodboard` child the page's board, so each use
 * waits while no family provides it and the gallery names neither family
 * (`model.ts`, `moodboard.ts`).
 */
export const galleryUiPlugin = definePlugin({
  name: galleryExtension.name,
  tags: familyTags(galleryExtension, "ui"),
  inject: [BrowserHostService],
  apply: (ctx) =>
    Effect.all(
      [
        ctx.plugin(galleryPlugin()),
        ctx.plugin(galleryModelPlugin),
        ctx.plugin(galleryMoodboardPlugin),
        ...GALLERY_WORKFLOW_SURFACES.map(({ key, Component }, order) =>
          ctx.contribute(
            ViewPoint,
            provideView(key, {
              placements: ["inline"],
              sample: {},
              picker: { order },
              Component,
            }),
          ),
        ),
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
