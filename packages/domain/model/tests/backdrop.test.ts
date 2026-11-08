/**
 * A page head's backdrop as its settings choose it (DESIGN-UI.md → Page-head
 * backdrops): each setting from the nearest node that holds one, the page's
 * own before core's, and the defaults where none does.
 */
import { describe, expect, test } from "bun:test";
import {
  BACKDROP_DIRECTION_OPTION_IDS,
  BACKDROP_OPTIONS,
  BACKDROP_STRENGTH_OPTION_IDS,
  BACKDROP_VARIANT_OPTIONS,
  SYSTEM_IDS,
  backdropChoice,
  backdropOptionId,
  backdropVariantOptions,
  declaredOptionId,
  drawVariant,
  knobsOf,
  shownStrength,
  shownVariants,
  type KbNode,
  type SeedBackdrop,
} from "../src/index.ts";

const core: KbNode["props"] = {
  [SYSTEM_IDS.backdropField]: [{ t: "ref", v: backdropOptionId("backdrops.gradient") }],
  [SYSTEM_IDS.backdropStrengthField]: [{ t: "ref", v: BACKDROP_STRENGTH_OPTION_IDS.vivid }],
  [SYSTEM_IDS.backdropDirectionField]: [{ t: "ref", v: BACKDROP_DIRECTION_OPTION_IDS.up }],
};

const CONTRIBUTED = ["backdrops.gradient", "backdrops.unicorn"];

const art = (v: string): KbNode["props"] => ({
  [SYSTEM_IDS.backdropArtField]: [{ t: "str", v }],
});

describe("backdropChoice", () => {
  test("with no settings: the first contributed, no strength chosen, facing down", () => {
    expect(backdropChoice([undefined, {}], CONTRIBUTED)).toEqual({
      backdrop: null,
      strength: null,
      direction: "down",
      art: null,
      variants: [],
    });
  });

  test("core's settings choose for every page", () => {
    expect(backdropChoice([undefined, core], CONTRIBUTED)).toEqual({
      backdrop: "backdrops.gradient",
      strength: "vivid",
      direction: "up",
      art: null,
      variants: [],
    });
  });

  test("a page's own setting wins, setting by setting; what it leaves unsaid is core's", () => {
    const page = {
      [SYSTEM_IDS.backdropField]: [{ t: "ref" as const, v: backdropOptionId("backdrops.unicorn") }],
    };
    expect(backdropChoice([page, core], CONTRIBUTED)).toEqual({
      backdrop: "backdrops.unicorn",
      strength: "vivid",
      direction: "up",
      art: null,
      variants: [],
    });
  });

  test("a value that reads as no option falls through to the next node", () => {
    const page = {
      [SYSTEM_IDS.backdropField]: [{ t: "str" as const, v: "backdrops.unicorn" }],
      [SYSTEM_IDS.backdropStrengthField]: [{ t: "ref" as const, v: "n.not-an-option" }],
    };
    expect(backdropChoice([page, core], CONTRIBUTED)).toEqual({
      backdrop: "backdrops.gradient",
      strength: "vivid",
      direction: "up",
      art: null,
      variants: [],
    });
  });

  test("a backdrop nobody contributes falls through to the next node, then to the first", () => {
    const page = {
      [SYSTEM_IDS.backdropField]: [{ t: "ref" as const, v: backdropOptionId("backdrops.gone") }],
    };
    expect(backdropChoice([page, core], CONTRIBUTED).backdrop).toBe("backdrops.gradient");
    expect(backdropChoice([page, core], ["backdrops.unicorn"]).backdrop).toBeNull();
  });

  test("art names an image or an art manifest of kb's assets, or it is none", () => {
    expect(backdropChoice([art("assets/signs.json")], CONTRIBUTED).art).toBe("assets/signs.json");
    expect(backdropChoice([art("https://example.com/signs.json")], CONTRIBUTED).art).toBeNull();
    expect(backdropChoice([art("assets/wolf.png"), core], CONTRIBUTED).art).toBe("assets/wolf.png");
    expect(backdropChoice([undefined, art("assets/wolf.png")], CONTRIBUTED).art).toBe(
      "assets/wolf.png",
    );
    expect(backdropChoice([art("https://example.com/wolf.png")], CONTRIBUTED).art).toBeNull();
    expect(backdropChoice([art("assets/notes.pdf")], CONTRIBUTED).art).toBeNull();
    expect(backdropChoice([art("/etc/passwd"), art("assets/b.webp")], CONTRIBUTED).art).toBe(
      "assets/b.webp",
    );
  });
});

/** A backdrop with three variants: two made for a dark page, one for a light one. */
const SKY: SeedBackdrop = {
  id: "backdrops.sky",
  label: "Sky",
  variants: [
    { id: "dusk", label: "Dusk", schemes: ["dark"] },
    { id: "night", label: "Night", schemes: ["dark"] },
    { id: "noon", label: "Noon", schemes: ["light"] },
  ],
};

const pin = (...ids: string[]): KbNode["props"] => ({
  [SYSTEM_IDS.backdropVariantField]: ids.map((id) => ({
    t: "ref" as const,
    v: declaredOptionId(BACKDROP_VARIANT_OPTIONS, id),
  })),
});

describe("backdrop variants", () => {
  test("each variant is a declared option that chooses its backdrop", () => {
    expect(backdropVariantOptions([SKY, { id: "backdrops.plain", label: "Plain" }])).toEqual(
      ["dusk", "night", "noon"].map((id) => ({
        id: `backdrops.sky.${id}`,
        label: `Sky · ${id[0]?.toUpperCase()}${id.slice(1)}`,
        chooses: [{ kind: BACKDROP_OPTIONS, id: "backdrops.sky" }],
      })),
    );
  });

  test("the nearest node that pins any holds the pinned set, whole", () => {
    const page = pin("backdrops.sky.dusk");
    const inherited = pin("backdrops.sky.night", "backdrops.sky.noon");
    expect(backdropChoice([page, inherited], CONTRIBUTED).variants).toEqual(["backdrops.sky.dusk"]);
    expect(backdropChoice([{}, inherited], CONTRIBUTED).variants).toEqual([
      "backdrops.sky.night",
      "backdrops.sky.noon",
    ]);
    expect(backdropChoice([{}, {}], CONTRIBUTED).variants).toEqual([]);
  });

  test("none pinned shows every variant made for the page's scheme", () => {
    expect(shownVariants(SKY, [], "dark")).toEqual(["dusk", "night"]);
    expect(shownVariants(SKY, [], "light")).toEqual(["noon"]);
  });

  test("one or many pinned: only those, of them the ones made for the scheme", () => {
    expect(shownVariants(SKY, ["backdrops.sky.night"], "dark")).toEqual(["night"]);
    expect(shownVariants(SKY, ["backdrops.sky.dusk", "backdrops.sky.noon"], "light")).toEqual([
      "noon",
    ]);
  });

  test("a pinned set with nothing for the scheme keeps the pin, drawn in its other look", () => {
    expect(shownVariants(SKY, ["backdrops.sky.night"], "light")).toEqual(["night"]);
  });

  test("another backdrop's pins are none of this one's; a backdrop without variants shows none", () => {
    expect(shownVariants(SKY, ["backdrops.lens.far"], "dark")).toEqual(["dusk", "night"]);
    expect(shownVariants({ id: "backdrops.plain", label: "Plain" }, [], "dark")).toEqual([]);
  });
});

describe("drawVariant", () => {
  const SHOWN = ["dusk", "night", "noon"] as const;

  test("draws one of the shown by the seed, the same every time for one load", () => {
    const drawn = drawVariant(42, SHOWN, null);
    expect(SHOWN.some((variant) => variant === drawn)).toBe(true);
    expect(drawVariant(42, SHOWN, null)).toBe(drawn);
    const seen = new Set(Array.from({ length: 40 }, (_, seed) => drawVariant(seed, SHOWN, null)));
    expect(seen.size).toBe(SHOWN.length);
  });

  test("keeps the one shown while it is still among them, and draws again when it is not", () => {
    expect(drawVariant(42, ["night", "noon"], "night")).toBe("night");
    expect(drawVariant(42, ["noon"], "night")).toBe("noon");
  });

  test("is none for a backdrop with no variants", () => {
    expect(drawVariant(42, [], null)).toBeNull();
    expect(drawVariant(42, [], "night")).toBeNull();
  });
});

describe("shownStrength", () => {
  const HOLE: SeedBackdrop = {
    id: "backdrops.hole",
    label: "Hole",
    variants: [
      { id: "plain", label: "Plain" },
      { id: "loud", label: "Loud", strength: "vivid" },
    ],
  };

  test("with none chosen: the drawn variant's own, else the default", () => {
    expect(shownStrength(null, HOLE, "loud")).toBe("vivid");
    expect(shownStrength(null, HOLE, "plain")).toBe("subtle");
    expect(shownStrength(null, HOLE, null)).toBe("subtle");
    expect(shownStrength(null, { id: "backdrops.flat", label: "Flat" }, null)).toBe("subtle");
  });

  test("with none chosen and no variant's own: the backdrop's declared default, else the default", () => {
    const SOFT: SeedBackdrop = { ...HOLE, id: "backdrops.soft", strength: "soft" };
    expect(shownStrength(null, SOFT, "plain")).toBe("soft");
    expect(shownStrength(null, SOFT, null)).toBe("soft");
    // A variant's own default is nearer than its backdrop's.
    expect(shownStrength(null, SOFT, "loud")).toBe("vivid");
    expect(shownStrength("subtle", SOFT, "plain")).toBe("subtle");
  });

  test("a strength chosen holds over the variant's", () => {
    expect(shownStrength("soft", HOLE, "loud")).toBe("soft");
    expect(shownStrength("subtle", HOLE, "loud")).toBe("subtle");
  });
});

describe("knobsOf", () => {
  const SPEED = {
    kind: "number",
    id: "speed",
    label: "Speed",
    min: 0,
    max: 2,
    step: 0.1,
    default: 1,
  } as const;
  const SPIN = { kind: "boolean", id: "spin", label: "Spin", default: true } as const;
  const HOLE: SeedBackdrop = {
    id: "backdrops.hole",
    label: "Hole",
    knobs: [SPEED],
    variants: [
      { id: "plain", label: "Plain" },
      { id: "warp", label: "Warp", knobs: [SPIN] },
    ],
  };

  test("the backdrop's knobs, then the drawn variant's own", () => {
    expect(knobsOf(HOLE, "warp").map(({ id }) => id)).toEqual(["speed", "spin"]);
    expect(knobsOf(HOLE, "plain").map(({ id }) => id)).toEqual(["speed"]);
    expect(knobsOf(HOLE, null).map(({ id }) => id)).toEqual(["speed"]);
    expect(knobsOf({ id: "backdrops.flat", label: "Flat" }, null)).toEqual([]);
  });
});
