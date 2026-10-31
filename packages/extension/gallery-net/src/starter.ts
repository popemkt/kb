/**
 * The starter library: a facet skeleton of public vocabulary, written as an
 * outline (DESIGN.md → Outline paste) for `node.addTree` to add as ordinary
 * nodes, where and when a person asks. It is not seeded: seeded nodes are
 * `sys.*` and write-guarded, and a person's facets and styles are theirs to
 * rename, move and delete.
 *
 * Most values are a name only. A style's prompt defaults to its name
 * (`libraryOf`), so "golden hour" composes as "golden hour" until someone
 * writes it a template. The vocabulary is the research record's §4 list:
 * shot sizes and angles (StudioBinder, Veo), camera moves (the names
 * Higgsfield, Luma, Kling and Veo share), lenses, lighting, moods,
 * colour schemes, film stocks, media and movements; and the 3D record's
 * (docs/research/2026-10-31-3d-styles-and-sources.md): 3D styles, rendering
 * techniques, 3D lighting setups, projections and presentations, which
 * carry their notes (`./starter-3d.ts`). The Artist facet ships empty:
 * which artists to name is the person's choice (§3). Facets are in
 * composer order, subject first then medium to mood (§2), and that order is
 * the outline's, so reordering them reorders every composition. The
 * library starts with pictures filed by those styles: public-domain works
 * and 3D renders made for it (`./starter-visuals.ts`). Both are the server
 * half's: the starter is added by the server's `ext.gallery.starter`, so
 * what it adds never reaches a page.
 */
import {
  LIGHTING_3D,
  NOTES_3D,
  PRESENTATIONS,
  PROJECTIONS,
  STYLES_3D,
  TECHNIQUES,
} from "./starter-3d.ts";

/** The name of the node the starter puts saved visuals under. */
export const STARTER_LIBRARY = "Library";

/**
 * A style the starter adds: its name, and, when the starter knows them, the
 * notes a person or a builder reads, each written as the field of the same
 * name (`description`, `prompt`, `negative`, `styles`, `seen in`, `how to`).
 * A bare string is a style named by name only, which takes the notes
 * `NOTES_3D` has for that name, if any.
 */
export interface StyleSeed {
  readonly name: string;
  /** What it looks like, in plain words. */
  readonly description?: string;
  readonly prompt?: string;
  readonly negative?: string;
  /** The starter's styles it is made with, by name: its `styles`. */
  readonly madeWith?: readonly string[];
  /** Works that show it. */
  readonly seenIn?: readonly string[];
  /** How to make it, one value per tool, each led by the tool's name. */
  // GAP [[01M68CQN0E7CMMEATHT0RDYV10]]: the tool is a word in the text, not a node.
  readonly howTo?: readonly string[];
}

/** A facet of the starter: its name and its styles, in composer order. */
type FacetSeed = readonly [facet: string, values: ReadonlyArray<string | StyleSeed>];

const FACETS: readonly FacetSeed[] = [
  [
    "Medium",
    [
      "photograph",
      "oil painting",
      "watercolor",
      "gouache",
      "charcoal drawing",
      "ink drawing",
      "pencil sketch",
      "woodcut",
      "screenprint",
      "collage",
      "papercut",
      "craft clay",
      "3D render",
      "pixel art",
      "digital art",
    ],
  ],
  [
    "Art movement",
    [
      "Baroque",
      "Ukiyo-e",
      "Impressionism",
      "Post-impressionism",
      "Art Nouveau",
      "Expressionism",
      "Cubism",
      "Constructivism",
      "Art Deco",
      "Bauhaus",
      "Surrealism",
      "Pop art",
      "Minimalism",
      "Vaporwave",
    ],
  ],
  ["3D style", STYLES_3D],
  ["Artist", []],
  ["Presentation", PRESENTATIONS],
  [
    "Shot size",
    [
      "extreme wide shot",
      "wide shot",
      "full shot",
      "cowboy shot",
      "medium shot",
      "medium close-up",
      "close-up",
      "extreme close-up",
    ],
  ],
  [
    "Camera angle",
    [
      "eye level",
      "low angle",
      "high angle",
      "bird's-eye view",
      "worm's-eye view",
      "Dutch angle",
      "over-the-shoulder",
      "point of view",
      "aerial view",
    ],
  ],
  ["Projection", PROJECTIONS],
  [
    "Camera motion",
    [
      "static shot",
      "pan",
      "tilt",
      "dolly in",
      "dolly out",
      "truck",
      "pedestal",
      "crane up",
      "crane down",
      "orbit",
      "tracking shot",
      "handheld",
      "whip pan",
      "crash zoom",
      "dolly zoom",
      "FPV drone",
      "bullet time",
      "hyperlapse",
      "slow motion",
    ],
  ],
  [
    "Lens",
    [
      "24mm wide-angle lens",
      "35mm lens",
      "50mm lens",
      "85mm portrait lens",
      "135mm telephoto lens",
      "fisheye lens",
      "macro lens",
      "anamorphic lens",
      "tilt-shift",
      "shallow depth of field",
      "deep focus",
      "lens flare",
    ],
  ],
  [
    "Lighting",
    [
      "golden hour",
      "blue hour",
      "overcast daylight",
      "moonlight",
      "candlelight",
      "neon lighting",
      "Rembrandt lighting",
      "chiaroscuro",
      "high key",
      "low key",
      "rim light",
      "backlight",
      "volumetric light",
      "hard flash",
      "softbox lighting",
      ...LIGHTING_3D,
    ],
  ],
  ["Rendering technique", TECHNIQUES],
  [
    "Palette",
    [
      "monochromatic",
      "complementary colors",
      "analogous colors",
      "triadic colors",
      "pastel palette",
      "muted earth tones",
      "neon palette",
      "black and white",
      "teal and orange",
      "duotone",
    ],
  ],
  [
    "Texture",
    [
      "film grain",
      "clean digital",
      "soft focus",
      "crisp detail",
      "halftone",
      "visible brushstrokes",
    ],
  ],
  [
    "Film stock",
    [
      "Kodak Portra 400",
      "Kodak Ektar 100",
      "Kodak Tri-X 400",
      "CineStill 800T",
      "Kodak Vision3 500T",
      "Kodachrome",
      "Fujifilm Superia",
      "Polaroid",
    ],
  ],
  [
    "Mood",
    [
      "cosy",
      "romantic",
      "joyful",
      "melancholic",
      "eerie",
      "tense",
      "serene",
      "dreamy",
      "epic",
      "whimsical",
    ],
  ],
  ["Era", ["1920s", "1950s", "1970s", "1980s", "1990s", "Y2K", "2000s digicam"]],
];

/** The starter as outline paste, with the line each node it names is on, for the ids `node.addTree` answers by line. */
export interface StarterOutline {
  readonly text: string;
  /** The `Library`'s line. */
  readonly library: number;
  /** Each style's line, by its name. */
  readonly styles: ReadonlyMap<string, number>;
}

/** A style as the starter writes it: one named by name only takes the notes it has there. */
const seedOf = (value: string | StyleSeed): StyleSeed =>
  typeof value === "string" ? { name: value, ...NOTES_3D[value] } : value;

/** A style's notes as field lines under it, at `indent`. */
function noteLines(seed: StyleSeed, indent: string): string[] {
  const one = (field: string, value: string | undefined) =>
    value === undefined ? [] : [`${indent}- ${field}:: ${value}`];
  const many = (field: string, values: readonly string[] | undefined) =>
    values === undefined || values.length === 0
      ? []
      : [`${indent}- ${field}::`, ...values.map((value) => `${indent}  - ${value}`)];
  return [
    ...one("description", seed.description),
    ...one("prompt", seed.prompt),
    ...one("negative", seed.negative),
    ...many(
      "styles",
      seed.madeWith?.map((name) => `[[${name}]]`),
    ),
    ...many("seen in", seed.seenIn),
    ...many("how to", seed.howTo),
  ];
}

/** The starter as outline paste: a `Styles` tree of facets and their styles, and the library. */
export function starterOutline(): StarterOutline {
  const lines = ["- Styles"];
  const styles = new Map<string, number>();
  for (const [facet, values] of FACETS) {
    lines.push(`  - ${facet} #facet`);
    for (const seed of values.map(seedOf)) {
      lines.push(`    - ${seed.name} #style`);
      styles.set(seed.name, lines.length);
      lines.push(...noteLines(seed, "      "));
    }
  }
  lines.push(`- ${STARTER_LIBRARY}`);
  return { text: lines.join("\n"), library: lines.length, styles };
}
