/**
 * The gallery family's shared package (DESIGN.md → Extension families;
 * docs/research/2026-10-28-visual-reference-gallery.md): its ids, seed,
 * declaration and view key, the action schemas, and the pure readings both
 * hosts share: the library and its facets, prompt composition and the
 * enhancer's request, the starter.
 */
export { GALLERY_IDS, GALLERY_SOURCE_IDS } from "./ids.ts";
export { galleryExtension, galleryPlugin } from "./extension.ts";
export { GalleryView } from "./view.ts";
export {
  GALLERY_ACTIONS,
  gallerySaveDef,
  galleryStarterDef,
  gallerySearchDef,
  type SourceResult,
} from "./actions.ts";
export {
  COMPOSE_TARGETS,
  composePrompt,
  type ComposeTarget,
  type Composition,
  type StyleTemplate,
} from "./compose.ts";
export { enhanceInput } from "./enhance.ts";
export {
  UNFILED,
  aspectOf,
  coverOf,
  creditOf,
  facetCounts,
  filterVisuals,
  imageSourcesOf,
  isTagged,
  libraryOf,
  negativeOf,
  orderedStyles,
  promptOf,
  searchUrlOf,
  sourceUrlOf,
  type FacetEntry,
  type FacetSelection,
  type GraphNode,
  type ImageSource,
  type Library,
  type StyleEntry,
} from "./library.ts";
export { STARTER_SIZE, starterOutline } from "./starter.ts";
