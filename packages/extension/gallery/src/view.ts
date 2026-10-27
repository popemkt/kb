/**
 * The gallery's view: the library page, every visual in the graph with its
 * facets, detail, compose and sources panels. It renders from the graph
 * alone, so it reads no settings.
 */
import { NoParams, viewKey } from "@kb/views";

/** The namespace of the gallery's view ids: what draws them, the gallery family. */
const GALLERY_NAMESPACE = "gallery";

export const GalleryView = viewKey(
  `${GALLERY_NAMESPACE}.library`,
  "Gallery",
  NoParams.annotate({
    description: "Every visual in the workspace, by facet. It reads no settings.",
  }),
);
