/**
 * The gallery family's seed, declared the way core declares its own tags and
 * fields. It seeds the vocabulary and the online sources, never a library:
 * facets and styles are a person's own nodes, added by the starter import
 * (`./starter.ts`) where they ask for it, so nothing they edit is write-guarded.
 * The bundled seed folds it after core's nodes (DESIGN.md → Extension
 * families → the seed is the bundled fold).
 */
import {
  SYSTEM_IDS,
  extensionNodeId,
  seededField,
  seededTag,
  type KbNode,
  type PropValue,
} from "@kb/model";
import { GALLERY_IDS, GALLERY_SOURCE_IDS } from "./ids.ts";

const ref = (v: string): PropValue[] => [{ t: "ref", v }];
const str = (v: string): PropValue[] => [{ t: "str", v }];

function plain(id: string, text: string, at: string, props: KbNode["props"] = {}): KbNode {
  return { id, text, props, children: [], createdAt: at, updatedAt: at };
}

/**
 * Each seeded source: its name, how it is searched, and its search page. An
 * API source keeps its page too, so its results can always be opened where
 * they live. The terms each source sets, and why each is an API or a link,
 * are the research record's §3.
 */
const SOURCES: ReadonlyArray<readonly [id: string, text: string, kind: string, url: string]> = [
  [
    GALLERY_SOURCE_IDS.civitai,
    "Civitai",
    GALLERY_IDS.kindCivitai,
    "https://civitai.com/search/models?sortBy=models_v9&query={query}",
  ],
  [
    GALLERY_SOURCE_IDS.openverse,
    "Openverse",
    GALLERY_IDS.kindOpenverse,
    "https://openverse.org/search/image?q={query}",
  ],
  [
    GALLERY_SOURCE_IDS.pinterest,
    "Pinterest",
    GALLERY_IDS.kindLink,
    "https://www.pinterest.com/search/pins/?q={query}",
  ],
  [GALLERY_SOURCE_IDS.arena, "Are.na", GALLERY_IDS.kindLink, "https://www.are.na/search?q={query}"],
  [
    GALLERY_SOURCE_IDS.unsplash,
    "Unsplash",
    GALLERY_IDS.kindLink,
    "https://unsplash.com/s/photos/{query}",
  ],
  [GALLERY_SOURCE_IDS.lexica, "Lexica", GALLERY_IDS.kindLink, "https://lexica.art/?q={query}"],
];

export function gallerySeedNodes(at: string): readonly KbNode[] {
  const kind = seededField(GALLERY_IDS.sourceKindField, "source kind", "ref", at, { one: true });
  return [
    seededField(GALLERY_IDS.mediaField, "media", "text", at),
    seededField(GALLERY_IDS.sourceField, "source", "url", at, { one: true }),
    seededField(GALLERY_IDS.creditField, "credit", "text", at, { one: true }),
    seededField(GALLERY_IDS.stylesField, "styles", "ref", at, {
      props: { [SYSTEM_IDS.targetTagField]: ref(GALLERY_IDS.styleTag) },
    }),
    seededField(GALLERY_IDS.promptField, "prompt", "text", at, { one: true }),
    seededField(GALLERY_IDS.negativeField, "negative", "text", at, { one: true }),
    seededField(GALLERY_IDS.widthField, "gallery.width", "number", at, { one: true, hidden: true }),
    seededField(GALLERY_IDS.heightField, "gallery.height", "number", at, {
      one: true,
      hidden: true,
    }),
    seededField(GALLERY_IDS.searchUrlField, "search url", "text", at, { one: true }),
    seededField(GALLERY_IDS.saveIntoField, "save into", "ref", at, {
      one: true,
      props: { [SYSTEM_IDS.configuresField]: ref(extensionNodeId("gallery")) },
    }),
    {
      ...kind,
      children: [GALLERY_IDS.kindLink, GALLERY_IDS.kindCivitai, GALLERY_IDS.kindOpenverse],
    },
    plain(GALLERY_IDS.kindLink, "link", at),
    plain(GALLERY_IDS.kindCivitai, "civitai", at),
    plain(GALLERY_IDS.kindOpenverse, "openverse", at),
    seededTag(
      GALLERY_IDS.visualTag,
      "visual",
      [
        GALLERY_IDS.mediaField,
        GALLERY_IDS.sourceField,
        GALLERY_IDS.creditField,
        GALLERY_IDS.stylesField,
        GALLERY_IDS.promptField,
        GALLERY_IDS.negativeField,
        GALLERY_IDS.widthField,
        GALLERY_IDS.heightField,
      ],
      at,
    ),
    seededTag(
      GALLERY_IDS.styleTag,
      "style",
      [GALLERY_IDS.promptField, GALLERY_IDS.negativeField, GALLERY_IDS.mediaField],
      at,
    ),
    seededTag(GALLERY_IDS.facetTag, "facet", [], at),
    seededTag(
      GALLERY_IDS.sourceTag,
      "image source",
      [GALLERY_IDS.searchUrlField, GALLERY_IDS.sourceKindField],
      at,
    ),
    ...SOURCES.map(([id, text, sourceKind, url]) =>
      plain(id, text, at, {
        [SYSTEM_IDS.typeField]: ref(GALLERY_IDS.sourceTag),
        [GALLERY_IDS.sourceKindField]: ref(sourceKind),
        [GALLERY_IDS.searchUrlField]: str(url),
      }),
    ),
  ];
}
