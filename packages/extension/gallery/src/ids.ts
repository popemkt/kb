/**
 * The gallery family's system ids (DESIGN.md → Extension families → ids are
 * frozen data). Its tags and fields are what a visual reference library is
 * made of (docs/research/2026-10-28-visual-reference-gallery.md §4): a
 * visual, a style that is also a facet value, the facet its styles sit
 * under, and the online sources the library searches; and what the
 * composer makes of them, a look (docs/research/2026-10-30-visual-composer.md §3).
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
  /** What the composer makes: a described, styled look with its pins and moodboard. */
  lookTag: "sys.tag.look",
  /** Markdown embeds of the item's media, `![alt](assets/…)` (text, many). */
  mediaField: "sys.f.gallery.media",
  /** Where a visual came from (url, one). */
  sourceField: "sys.f.gallery.source",
  /** Who made it and on what terms, as the source states (text, one). */
  creditField: "sys.f.gallery.credit",
  /** The styles a visual shows, a look chooses, or a style is made with (ref to #style, many). */
  stylesField: "sys.f.gallery.styles",
  /** Works that show a style: games, films, prints (text, many). */
  seenInField: "sys.f.gallery.seen-in",
  /** How to make a style, one value per tool, led by the tool's name (text, many). */
  howToField: "sys.f.gallery.how-to",
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
  /** A look's brief, and its composer's subject; what a style looks like (text, one). */
  descriptionField: "sys.f.gallery.description",
  /** A look's swatches, `#rrggbb`, taken from its pins (text, many). */
  paletteField: "sys.f.gallery.palette",
  /** The visual a look's pin stands for; the pin's text is its note (ref, one). */
  referenceField: "sys.f.gallery.reference",
  /** The node a look art-directs (ref, one). */
  forField: "sys.f.gallery.for",
  /** Where a saved visual goes: a setting of the gallery (ref, one). */
  saveIntoField: "sys.f.gallery.save-into",
  /** Open the search page in a new tab, and nothing else. */
  kindLink: "sys.gallery.source-kind.link",
  /** Civitai's public REST API. */
  kindCivitai: "sys.gallery.source-kind.civitai",
  /** Openverse's public REST API. */
  kindOpenverse: "sys.gallery.source-kind.openverse",
  /** Sketchfab's Data API search, Creative Commons models only. */
  kindSketchfab: "sys.gallery.source-kind.sketchfab",
  /** Poly Haven's published catalogue of CC0 HDRIs, textures and models. */
  kindPolyHaven: "sys.gallery.source-kind.polyhaven",
  /** The three.js examples' published list, with their screenshots. */
  kindThreeExamples: "sys.gallery.source-kind.threejs-examples",
} as const;

/** The sources the family seeds, in the panel's order. */
export const GALLERY_SOURCE_IDS = {
  civitai: "sys.gallery.source.civitai",
  openverse: "sys.gallery.source.openverse",
  pinterest: "sys.gallery.source.pinterest",
  arena: "sys.gallery.source.arena",
  unsplash: "sys.gallery.source.unsplash",
  lexica: "sys.gallery.source.lexica",
  sketchfab: "sys.gallery.source.sketchfab",
  polyhaven: "sys.gallery.source.polyhaven",
  threejsExamples: "sys.gallery.source.threejs-examples",
  artstation: "sys.gallery.source.artstation",
  shadertoy: "sys.gallery.source.shadertoy",
  godotShaders: "sys.gallery.source.godot-shaders",
  blenderStudio: "sys.gallery.source.blender-studio",
  blenderArtists: "sys.gallery.source.blender-artists",
  blendkit: "sys.gallery.source.blendkit",
  youtube: "sys.gallery.source.youtube",
} as const;
