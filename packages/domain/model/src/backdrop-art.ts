/**
 * A backdrop's art (DESIGN-UI.md → Page-head backdrops → The art setting):
 * the parts of its picture a backdrop draws in place of its own. The art
 * setting names one of two forms, and both read as one `BackdropArt`:
 *
 * - **An image** of kb's assets: the backdrop's hero picture, nothing else.
 * - **A manifest** of kb's assets (`.json`), naming several parts: the hero
 *   picture (`image`) and the glyphs a backdrop sets about it (`glyphs`),
 *   each a shape (SVG path data in a view box, stroked or filled, or an
 *   image whose alpha is its shape) and a colour. Its references are files
 *   beside it, so a manifest can only name kb's own assets.
 *
 * A part the art leaves out (null) is the backdrop's own: kb's built-in
 * glyphs are the default implementation of the same part, never a second
 * path. Pure, so the manifest's reading is tested without a browser.
 */
import { mediaKindFromHref } from "./asset.ts";

/** A glyph's shape: path data in its view box (stroked `stroke` wide, or filled with none), or an image's alpha. */
export type BackdropGlyphShape =
  | {
      readonly kind: "path";
      readonly d: string;
      readonly viewBox: readonly [number, number, number, number];
      readonly stroke: number | null;
    }
  | { readonly kind: "image"; readonly src: string };

/** One glyph: its name (for people), its colour (`#rrggbb`; null, the backdrop's own for its place), its shape. */
export interface BackdropGlyph {
  readonly name: string | null;
  readonly color: string | null;
  readonly shape: BackdropGlyphShape;
}

/** The parts a backdrop draws in place of its own; null, its own. */
export interface BackdropArt {
  readonly image: string | null;
  readonly glyphs: readonly BackdropGlyph[] | null;
}

/** Art that replaces nothing. */
export const OWN_ART: BackdropArt = { image: null, glyphs: null };

/** The most glyphs a manifest may name; past them, the rest are left out. */
export const MAX_BACKDROP_GLYPHS = 8;

/** Whether a path or URL names an art manifest, by its extension. */
export function isArtManifest(href: string): boolean {
  return /\.json(?:$|[?#])/i.test(href.trim());
}

/** Whether a path or URL names art a backdrop reads: an image or an art manifest. */
export function isBackdropArt(href: string): boolean {
  return mediaKindFromHref(href) === "image" || isArtManifest(href);
}

/** The art an image is: its hero picture, nothing else. */
export function imageArt(href: string): BackdropArt {
  return { image: href, glyphs: null };
}

type Json = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A reference in a manifest, resolved against the manifest's own place
 * (`at`, a path or URL): a file beside it or below it, named plainly. A
 * scheme, a root, a `..` or anything that is not an image is no reference.
 */
function besideImage(ref: unknown, at: string): string | null {
  if (typeof ref !== "string") return null;
  const name = ref.trim();
  const plain = /^[\w-][\w .-]*(?:\/[\w-][\w .-]*)*$/.test(name);
  if (!plain || name.split("/").includes("..") || mediaKindFromHref(name) !== "image") return null;
  return `${at.slice(0, at.lastIndexOf("/") + 1)}${name}`;
}

/** `#rgb` or `#rrggbb`, as `#rrggbb` (lower case); anything else is no colour. */
function colourOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())?.[1]?.toLowerCase();
  if (hex === undefined) return null;
  return `#${hex.length === 3 ? hex.replace(/./g, "$&$&") : hex}`;
}

function viewBoxOf(value: unknown): readonly [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const numbers = value.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  const [x, y, w, h] = numbers;
  return x !== undefined && y !== undefined && w !== undefined && h !== undefined && w > 0 && h > 0
    ? [x, y, w, h]
    : null;
}

function shapeOf(glyph: Json, at: string): BackdropGlyphShape | null {
  if (typeof glyph["path"] === "string" && glyph["path"].trim() !== "") {
    const viewBox = viewBoxOf(glyph["viewBox"] ?? [0, 0, 100, 100]);
    const stroke = glyph["stroke"];
    if (viewBox === null) return null;
    return {
      kind: "path",
      d: glyph["path"],
      viewBox,
      stroke: typeof stroke === "number" && stroke > 0 ? stroke : null,
    };
  }
  const src = besideImage(glyph["image"], at);
  return src === null ? null : { kind: "image", src };
}

function glyphOf(value: unknown, at: string): BackdropGlyph | null {
  if (!isRecord(value)) return null;
  const shape = shapeOf(value, at);
  if (shape === null) return null;
  const name = value["name"];
  return { name: typeof name === "string" ? name : null, color: colourOf(value["color"]), shape };
}

/**
 * The art a manifest names, read from the manifest at `at` (its path or
 * URL, which its references resolve beside): its hero `image` and its
 * `glyphs`, in order. A part it does not name, or names wrongly, is the
 * backdrop's own; a glyph that is no glyph is left out, and so is any past
 * `MAX_BACKDROP_GLYPHS`. A manifest that is not an object replaces nothing.
 */
export function backdropArtOf(manifest: unknown, at: string): BackdropArt {
  if (!isRecord(manifest)) return OWN_ART;
  const listed = manifest["glyphs"];
  const glyphs = Array.isArray(listed)
    ? listed
        .map((glyph: unknown) => glyphOf(glyph, at))
        .filter((glyph): glyph is BackdropGlyph => glyph !== null)
        .slice(0, MAX_BACKDROP_GLYPHS)
    : [];
  return { image: besideImage(manifest["image"], at), glyphs: glyphs.length > 0 ? glyphs : null };
}
