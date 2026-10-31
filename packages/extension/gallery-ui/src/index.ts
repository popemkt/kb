/**
 * `@kb/gallery-ui`: the gallery family's browser half (DESIGN.md →
 * Extension families; DESIGN-UI.md → The gallery): the gallery page, a
 * virtualised masonry of every visual with its facets, detail, composer and
 * online sources, and its sidebar row. The page loads the entry,
 * `galleryUiPlugin`, as an import() chunk, only while the server reports
 * the gallery switched on.
 */
export { galleryUiPlugin } from "./plugin";
