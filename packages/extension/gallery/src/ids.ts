/**
 * The gallery family's system ids (DESIGN.md → Extension families → ids are
 * frozen data). Its tags and fields are what a visual reference library is
 * made of (docs/research/2026-10-28-visual-reference-gallery.md §4): a
 * visual, a style that is also a facet value, the facet its styles sit
 * under, and the online sources the library searches.
 */
export const GALLERY_IDS = {
  /** One picture or clip in the library. */
  visualTag: "sys.tag.visual",
  /** A named, composable look; the value of the facet it sits under. */
  styleTag: "sys.tag.style",
  /** An axis of the library: its descendant styles are its values. */
  facetTag: "sys.tag.facet",
  /** An online source the sources panel searches or links to. */
  sourceTag: "sys.tag.image-source",
  /** Markdown embeds of the item's media, `![alt](assets/…)` (text, many). */
  mediaField: "sys.f.gallery.media",
  /** Where a visual came from (url, one). */
  sourceField: "sys.f.gallery.source",
  /** Who made it and on what terms, as the source states (text, one). */
  creditField: "sys.f.gallery.credit",
  /** The styles a visual shows (ref to #style, many). */
  stylesField: "sys.f.gallery.styles",
  /** A style's template, or the prompt a visual was made with (text, one). */
  promptField: "sys.f.gallery.prompt",
  /** The negative counterpart of `prompt` (text, one). */
  negativeField: "sys.f.gallery.negative",
  /** The cover's pixel width, written when kb imports the file (number, one). */
  widthField: "sys.f.gallery.width",
  /** The cover's pixel height (number, one). */
  heightField: "sys.f.gallery.height",
  /** A source's search page, a URL template with `{query}` (text, one). */
  searchUrlField: "sys.f.gallery.search-url",
  /** How a source is searched: an option node (ref, one). */
  sourceKindField: "sys.f.gallery.source-kind",
  /** Where a saved visual goes: a setting of the gallery (ref, one). */
  saveIntoField: "sys.f.gallery.save-into",
  /** Open the search page in a new tab, and nothing else. */
  kindLink: "sys.gallery.source-kind.link",
  /** Civitai's public REST API. */
  kindCivitai: "sys.gallery.source-kind.civitai",
  /** Openverse's public REST API. */
  kindOpenverse: "sys.gallery.source-kind.openverse",
} as const;

/** The sources the family seeds, in the panel's order. */
export const GALLERY_SOURCE_IDS = {
  civitai: "sys.gallery.source.civitai",
  openverse: "sys.gallery.source.openverse",
  pinterest: "sys.gallery.source.pinterest",
  arena: "sys.gallery.source.arena",
  unsplash: "sys.gallery.source.unsplash",
  lexica: "sys.gallery.source.lexica",
} as const;
