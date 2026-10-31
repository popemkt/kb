/**
 * The starter library: a facet skeleton of public vocabulary, written as an
 * outline (DESIGN.md → Outline paste) for `node.addTree` to add as ordinary
 * nodes, where and when a person asks. It is not seeded: seeded nodes are
 * `sys.*` and write-guarded, and a person's facets and styles are theirs to
 * rename, move and delete.
 *
 * Every value is a name only. A style's prompt defaults to its name
 * (`./library.ts`), so "golden hour" composes as "golden hour" until someone
 * writes it a template. The vocabulary is the research record's §4 list:
 * shot sizes and angles (StudioBinder, Veo), camera moves (the names
 * Higgsfield, Luma, Kling and Veo share), lenses, lighting, moods,
 * colour schemes, film stocks, media and movements. The Artist facet ships
 * empty: which artists to name is the person's choice (§3). Facets are in
 * composer order, subject first then medium to mood (§2), and that order is
 * the outline's, so reordering them reorders every composition. The
 * library starts with a dozen public-domain pictures filed by those styles,
 * which are the server half's (`@kb/gallery-net`, `starter-visuals.ts`).
 */

/** The name of the node the starter puts saved visuals under. */
export const STARTER_LIBRARY = "Library";

const FACETS: ReadonlyArray<readonly [facet: string, values: readonly string[]]> = [
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
  ["Artist", []],
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
    ],
  ],
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

/** The starter as outline paste: a `Styles` tree of facets and their styles, and the library. */
export function starterOutline(): StarterOutline {
  const lines = ["- Styles"];
  const styles = new Map<string, number>();
  for (const [facet, values] of FACETS) {
    lines.push(`  - ${facet} #facet`);
    for (const value of values) {
      lines.push(`    - ${value} #style`);
      styles.set(value, lines.length);
    }
  }
  lines.push(`- ${STARTER_LIBRARY}`);
  return { text: lines.join("\n"), library: lines.length, styles };
}

/** How many facets and styles the starter adds. */
export const STARTER_SIZE = {
  facets: FACETS.length,
  styles: FACETS.reduce((n, [, values]) => n + values.length, 0),
};
