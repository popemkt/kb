/**
 * The gallery family's shared package (DESIGN.md → Extension families;
 * docs/research/2026-10-28-visual-reference-gallery.md): its ids, seed,
 * declaration and view key, the action schemas, and the pure readings both
 * hosts share: the library and its facets, prompt composition and the
 * enhancer's request; and the composer's: its workflows' keys,
 * the look, the palette, and the readings that articulate an idea.
 */
export { GALLERY_IDS, GALLERY_SOURCE_IDS } from "./ids.ts";
export { galleryExtension, galleryPlugin } from "./extension.ts";
export {
  ArticulateWorkflow,
  BrowseWorkflow,
  CaptureWorkflow,
  ComposerParams,
  GALLERY_WORKFLOWS,
  GalleryView,
  KnowWorkflow,
  NodeWorkflow,
  ReferenceWorkflow,
  RemixWorkflow,
  SceneWorkflow,
  WorkflowParams,
  isWorkflowKey,
  workflowKey,
  type WorkflowKey,
  type WorkflowTraits,
} from "./view.ts";
export {
  EMPTY_LOOK,
  briefOf,
  lookOf,
  lookWrites,
  looksOf,
  nameOf,
  promptsOf,
  type LookDraft,
  type LookWrite,
  type Pin,
} from "./look.ts";
export { LOOK_EXPORTS, exportFileName, type LookExport } from "./exports.ts";
export { artDirectionOf, stylesCalledFor } from "./art-direction.ts";
export { paletteOf } from "./palette.ts";
export {
  axesOf,
  axisStyles,
  chipsFor,
  eitherOrs,
  examplesOf,
  moreLike,
  nearest,
  parseReflection,
  reflectInput,
  variationsOf,
  type Axis,
  type Chip,
  type Reflection,
} from "./articulate.ts";
export {
  GALLERY_ACTIONS,
  galleryCaptureDef,
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
