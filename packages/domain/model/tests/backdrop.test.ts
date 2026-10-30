/**
 * A page head's backdrop as its settings choose it (DESIGN-UI.md → Page-head
 * backdrops): each setting from the nearest node that holds one, the page's
 * own before core's, and the defaults where none does.
 */
import { describe, expect, test } from "bun:test";
import {
  BACKDROP_DIRECTION_OPTION_IDS,
  BACKDROP_STRENGTH_OPTION_IDS,
  SYSTEM_IDS,
  backdropChoice,
  backdropOptionId,
  type KbNode,
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
  test("with no settings: the first contributed, subtle, facing down", () => {
    expect(backdropChoice([undefined, {}], CONTRIBUTED)).toEqual({
      backdrop: null,
      strength: "subtle",
      direction: "down",
      art: null,
    });
  });

  test("core's settings choose for every page", () => {
    expect(backdropChoice([undefined, core], CONTRIBUTED)).toEqual({
      backdrop: "backdrops.gradient",
      strength: "vivid",
      direction: "up",
      art: null,
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
    });
  });

  test("a backdrop nobody contributes falls through to the next node, then to the first", () => {
    const page = {
      [SYSTEM_IDS.backdropField]: [{ t: "ref" as const, v: backdropOptionId("backdrops.gone") }],
    };
    expect(backdropChoice([page, core], CONTRIBUTED).backdrop).toBe("backdrops.gradient");
    expect(backdropChoice([page, core], ["backdrops.unicorn"]).backdrop).toBeNull();
  });

  test("art names an image of kb's assets, or it is none", () => {
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
