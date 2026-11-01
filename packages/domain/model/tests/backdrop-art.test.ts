/**
 * A backdrop's art as the art setting names it (DESIGN-UI.md → Page-head
 * backdrops → The art setting): one image, or a manifest of several parts,
 * both read as one `BackdropArt`; what a manifest leaves out or names
 * wrongly is the backdrop's own.
 */
import { describe, expect, test } from "bun:test";
import {
  MAX_BACKDROP_GLYPHS,
  OWN_ART,
  backdropArtOf,
  imageArt,
  isArtManifest,
  isBackdropArt,
} from "../src/index.ts";

const AT = "/assets/signs.json";

describe("backdrop art", () => {
  test("an image is the hero picture alone", () => {
    expect(imageArt("/assets/wolf.png")).toEqual({ image: "/assets/wolf.png", glyphs: null });
    expect(isBackdropArt("assets/wolf.png")).toBe(true);
    expect(isBackdropArt("assets/signs.json")).toBe(true);
    expect(isBackdropArt("assets/notes.pdf")).toBe(false);
    expect(isArtManifest("/assets/signs.json?v=2")).toBe(true);
    expect(isArtManifest("/assets/wolf.png")).toBe(false);
  });

  test("a manifest names the hero picture and the glyphs, resolved beside it", () => {
    const art = backdropArtOf(
      {
        image: "wolf.png",
        glyphs: [
          { name: "a", color: "#7CF", path: "M 0,0 L 10,10", viewBox: [0, 0, 10, 10], stroke: 1 },
          { name: "b", color: "#ff5a24", path: "M 0,0 L 1,1 Z" },
          { color: "red", image: "glyphs/c.png" },
        ],
      },
      AT,
    );
    expect(art.image).toBe("/assets/wolf.png");
    expect(art.glyphs).toEqual([
      {
        name: "a",
        color: "#77ccff",
        shape: { kind: "path", d: "M 0,0 L 10,10", viewBox: [0, 0, 10, 10], stroke: 1 },
      },
      {
        name: "b",
        color: "#ff5a24",
        shape: { kind: "path", d: "M 0,0 L 1,1 Z", viewBox: [0, 0, 100, 100], stroke: null },
      },
      { name: null, color: null, shape: { kind: "image", src: "/assets/glyphs/c.png" } },
    ]);
  });

  test("what a manifest leaves out or names wrongly is the backdrop's own", () => {
    expect(backdropArtOf([], AT)).toEqual(OWN_ART);
    expect(backdropArtOf("wolf.png", AT)).toEqual(OWN_ART);
    expect(backdropArtOf({ glyphs: [] }, AT)).toEqual(OWN_ART);
    expect(backdropArtOf({ image: "wolf.png" }, AT)).toEqual({
      image: "/assets/wolf.png",
      glyphs: null,
    });
    const wrong = backdropArtOf(
      {
        image: "notes.pdf",
        glyphs: [
          { image: "../secret.png" },
          { image: "https://example.com/a.png" },
          { image: "/etc/a.png" },
          { path: "M 0,0", viewBox: [0, 0, 0, 10] },
          { path: "" },
          "M 0,0",
        ],
      },
      AT,
    );
    expect(wrong).toEqual(OWN_ART);
  });

  test("names at most the glyphs a backdrop can set", () => {
    const glyphs = Array.from({ length: 12 }, () => ({ path: "M 0,0 L 1,1" }));
    expect(backdropArtOf({ glyphs }, AT).glyphs).toHaveLength(MAX_BACKDROP_GLYPHS);
  });
});
