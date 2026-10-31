/**
 * Glyphs as a backdrop draws them: every glyph's shape, whoever drew it (a
 * backdrop's own, or the art setting's, `BackdropGlyph`), rasterised once
 * into one cell of an atlas, and read in the frame by its index. One path
 * for every glyph, so an owner's glyphs and kb's built-in ones are drawn,
 * coloured and filtered alike.
 *
 * Each cell holds a glyph's coverage (red) and its glow (green, the
 * coverage blurred), the glyph filling a disc of radius 1 at the cell's
 * centre and the cell reaching `GLYPH_REACH` glyph radii, room for the glow
 * and the mip chain. The atlas keeps its mip chain, and a read takes its
 * footprint from the caller's derivatives (`read`'s `dx`, `dy`), so a glyph
 * is antialiased at device pixels however small it is drawn, and a read
 * whose cell changes from one pixel to the next (a circle's slots) never
 * picks a wrong level at the seam.
 */
import { abs, float, int, max, step, texture, uniform, uniformArray, vec2 } from "three/tsl";
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  Vector3,
  Color,
} from "three/webgpu";
import type { BackdropGlyphShape } from "@kb/model";
import type { TslNode } from "@kb/scene-gpu";

type F = TslNode<"float">;
type V2 = TslNode<"vec2">;
type V3 = TslNode<"vec3">;
type V4 = TslNode<"vec4">;

/** How many glyphs the atlas holds, side by side. */
const GLYPH_SLOTS = 8;
/** A cell's side (texels). */
const CELL = 128;
/** How far a cell reaches from its centre, in glyph radii. */
const GLYPH_REACH = 1.4;
/** The glow's blur (texels, each of three box passes): soft, a little past the stroke. */
const GLOW_BLUR = 6;
/** How bright the glow's peak is drawn, so a thin stroke's glow is still a glow. */
const GLOW_GAIN = 1.25;

/** A glyph to draw: its shape and its colour (`#rrggbb`). */
export interface GlyphPaint {
  readonly shape: BackdropGlyphShape;
  readonly color: string;
}

/** A glyph radius, in texels. */
const RADIUS = CELL / (2 * GLYPH_REACH);

/** A glyph's shape ready to draw: its path, or its image fetched. */
type Drawable =
  | Extract<BackdropGlyphShape, { readonly kind: "path" }>
  | { readonly kind: "image"; readonly image: ImageBitmap };

async function drawableOf(shape: BackdropGlyphShape): Promise<Drawable> {
  if (shape.kind === "path") return shape;
  const response = await fetch(shape.src);
  if (!response.ok) throw new Error(`glyph ${shape.src}: ${response.status}`);
  return { kind: "image", image: await createImageBitmap(await response.blob()) };
}

/** Draw `shape` white into cell `k` of `context`, fitted into the glyph's disc. */
function drawShape(context: OffscreenCanvasRenderingContext2D, shape: Drawable, k: number) {
  const cx = (k + 0.5) * CELL;
  const cy = CELL / 2;
  context.save();
  context.fillStyle = "#fff";
  context.strokeStyle = "#fff";
  if (shape.kind === "path") {
    const [x, y, w, h] = shape.viewBox;
    const scale = (2 * RADIUS) / Math.max(w, h);
    context.setTransform(scale, 0, 0, scale, cx - (x + w / 2) * scale, cy - (y + h / 2) * scale);
    const path = new Path2D(shape.d);
    if (shape.stroke === null) {
      // oxlint-disable-next-line unicorn/no-array-fill-with-reference-type -- a canvas's fill(path), not Array#fill
      context.fill(path);
    } else {
      context.lineWidth = shape.stroke;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.stroke(path);
    }
  } else {
    const { image } = shape;
    const scale = (2 * RADIUS) / Math.max(image.width, image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    context.drawImage(image, cx - w / 2, cy - h / 2, w, h);
    image.close();
  }
  context.restore();
}

/** Three box blurs of `radius` over a copy of `values` (`width` × `height`), across then down: near a Gaussian. */
function blurred(
  values: Float32Array<ArrayBuffer>,
  width: number,
  height: number,
  radius: number,
): Float32Array<ArrayBuffer> {
  let from = values.slice();
  let to = new Float32Array(values.length);
  const pass = (along: number, lines: number, at: (line: number, i: number) => number) => {
    for (let line = 0; line < lines; line++) {
      let sum = 0;
      for (let i = -radius; i <= radius; i++)
        sum += from[at(line, Math.min(along - 1, Math.max(0, i)))] ?? 0;
      for (let i = 0; i < along; i++) {
        to[at(line, i)] = sum / (2 * radius + 1);
        sum +=
          (from[at(line, Math.min(along - 1, i + radius + 1))] ?? 0) -
          (from[at(line, Math.max(0, i - radius))] ?? 0);
      }
    }
    [from, to] = [to, from];
  };
  for (let n = 0; n < 3; n++) {
    pass(width, height, (row, i) => row * width + i);
    pass(height, width, (column, i) => i * width + column);
  }
  return from;
}

/**
 * The atlas: `read` a glyph's coverage and glow, `color` its colour, `count`
 * how many there are; `set` draws a set of glyphs into it (settling once
 * drawn; a set given while one is drawing wins).
 */
export function glyphAtlas() {
  const width = CELL * GLYPH_SLOTS;
  const data = new Uint8Array(width * CELL * 4);
  const image = new DataTexture(data, width, CELL, RGBAFormat);
  image.generateMipmaps = true;
  image.minFilter = LinearMipmapLinearFilter;
  image.magFilter = LinearFilter;
  image.needsUpdate = true;
  const atlas = texture(image);
  const count = uniform(1);
  const colors = uniformArray<"vec3">(
    Array.from({ length: GLYPH_SLOTS }, () => new Vector3(1, 1, 1)),
    "vec3",
  );
  let drawing = 0;
  const toCell = 0.5 / GLYPH_REACH;

  return {
    /** How many glyphs are drawn. */
    count,
    /**
     * Glyph `k`'s coverage (x) and glow (y) at `local` (glyph radii from its
     * centre, y up), over the footprint `dx`, `dy` (how far `local` moves a
     * pixel across and down); nothing past its cell.
     */
    read: (k: F, local: V2, dx: V2, dy: V2): V4 => {
      const at = vec2(
        k.add(local.x.mul(toCell).add(0.5)).div(GLYPH_SLOTS),
        float(0.5).sub(local.y.mul(toCell)),
      );
      const scale = vec2(toCell / GLYPH_SLOTS, -toCell);
      const inside = step(max(abs(local.x), abs(local.y)), float(GLYPH_REACH));
      const sampled: V4 = atlas.sample(at).grad(dx.mul(scale), dy.mul(scale));
      return sampled.mul(inside);
    },
    /** Glyph `k`'s colour (linear). */
    color: (k: F): V3 => colors.element(int(k)),
    set: async (glyphs: readonly GlyphPaint[]): Promise<void> => {
      const mine = ++drawing;
      const canvas = new OffscreenCanvas(width, CELL);
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("glyph atlas: no 2d context");
      const shown = glyphs.slice(0, GLYPH_SLOTS);
      const drawables = await Promise.all(shown.map((glyph) => drawableOf(glyph.shape)));
      if (mine !== drawing) return;
      drawables.forEach((drawable, k) => drawShape(context, drawable, k));
      const pixels = context.getImageData(0, 0, width, CELL).data;
      const cover = new Float32Array(width * CELL);
      for (let i = 0; i < cover.length; i++) cover[i] = (pixels[i * 4 + 3] ?? 0) / 255;
      const glow = blurred(cover, width, CELL, GLOW_BLUR);
      for (let i = 0; i < cover.length; i++) {
        data[i * 4] = Math.round((cover[i] ?? 0) * 255);
        data[i * 4 + 1] = Math.round(Math.min(1, (glow[i] ?? 0) * GLOW_GAIN) * 255);
        data[i * 4 + 2] = 0;
        data[i * 4 + 3] = 255;
      }
      image.needsUpdate = true;
      shown.forEach((glyph, k) => {
        const linear = new Color(glyph.color);
        colors.array[k] = new Vector3(linear.r, linear.g, linear.b);
      });
      count.value = Math.max(1, shown.length);
    },
    dispose: () => {
      drawing++;
      image.dispose();
    },
  };
}
export type GlyphAtlas = ReturnType<typeof glyphAtlas>;
