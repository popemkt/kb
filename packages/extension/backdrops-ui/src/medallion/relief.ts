/**
 * The medallion's relief, baked once into a picture the frame reads
 * (DESIGN-UI.md → Page-head backdrops → GPU scenes → Wolf medallion).
 *
 * Its source is one of two, and everything after the source is one path:
 *
 * - **kb's own sigil** (`medallion.ts`), drawn as a height field: the disk
 *   with a rim that is not quite round, notched, the gabled mask on it, the
 *   engraving cut in, and a bail at the top for the chain.
 * - **An image** the backdrop's art setting points at (`BackdropChoice.art`,
 *   a file of `.kb/assets`): red is height (0 the deepest recess, 1 the
 *   highest point), green where it glows (its eyes), alpha its silhouette.
 *   It is square, its round body 0.4 of its width about its centre, so it
 *   covers the same `EXTENT` as the sigil.
 *
 * Three passes, each run only when the source changes: the source, as
 * height, glow and silhouette; its edge cleaned (`EDGE`): the silhouette
 * eroded past any matte its edge carries, and the height run on flat past
 * the silhouette's cut, the highest round each point there, so the frame's
 * slope never finds a cliff at the cut to light as an outline; then the
 * material's maps, height, cavity (how far a point lies below the relief
 * round it, where grime and patina collect), glow and silhouette. The frame
 * takes the relief's slope from the baked height a texel across.
 */
import {
  Fn,
  abs,
  atan,
  clamp,
  dot,
  float,
  fract,
  length,
  max,
  min,
  mix,
  smoothstep,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec4,
} from "three/tsl";
import { DataTexture, RGBAFormat, Texture, type WebGPURenderer } from "three/webgpu";
import { offscreenPass, type TslNode } from "@kb/scene-gpu";
import { gnoise } from "../gpu/noise";
import { TAU } from "../scene/math";
import { ENGRAVING, EYES, MASK, type Point, type Stroke } from "./medallion";

type F = TslNode<"float">;
type V2 = TslNode<"vec2">;
type V4 = TslNode<"vec4">;

/** How far the baked picture reaches from the centre (medallion units): an image's round body is 0.4 of its width. */
export const EXTENT = 1.25;
/** The baked picture's side (texels): the disk is about 800 of them across, finer than a device pixel at any width it is shown. */
const SIDE = 1024;
/** How deep an image's relief is, in the sigil's height units. */
const IMAGE_DEPTH = 0.75;
/** Where the sigil's bail sits (medallion units): the chain leaves from its top. */
export const SIGIL_BAIL = { y: 1.07, radius: 0.055, wire: 0.02 } as const;

/** A stroke's distance from `q`. */
function segment(q: V2, [[ax, ay], [bx, by]]: Stroke): F {
  const ex = bx - ax;
  const ey = by - ay;
  const along = vec2(ex, ey);
  const w = q.sub(vec2(ax, ay));
  const h = clamp(dot(w, along).mul(1 / (ex * ex + ey * ey)), 0, 1);
  return length(w.sub(along.mul(h)));
}

/** The nearest of `strokes` from `q`. */
export const nearest = (q: V2, strokes: readonly Stroke[]): F =>
  strokes.map((stroke) => segment(q, stroke)).reduce((a, b) => min(a, b));

/** A closed polygon's signed distance from `q`: negative inside. */
function polygon(q: V2, points: readonly Point[]): F {
  let d: F = float(1e3);
  let sign: F = float(1);
  points.forEach((at, i) => {
    const before = points[(i + points.length - 1) % points.length] ?? at;
    d = min(d, segment(q, [at, before]));
    const ex = before[0] - at[0];
    const ey = before[1] - at[1];
    const above = step(at[1], q.y);
    const below = float(1).sub(step(before[1], q.y));
    const left = step(0, q.y.sub(at[1]).mul(ex).sub(q.x.sub(at[0]).mul(ey)));
    const crosses = above
      .mul(below)
      .mul(left)
      .add(float(1).sub(above).mul(float(1).sub(below)).mul(float(1).sub(left)));
    sign = sign.mul(float(1).sub(crosses.mul(2)));
  });
  return d.mul(sign);
}

/**
 * kb's sigil at `q` (medallion units; `px` a texel's width in them): its
 * height, where it glows, and its silhouette. The rim is cast, not turned:
 * a few thousandths out of round.
 */
const sigilFn = Fn(([q, px]: readonly [V2, F]) => {
  const angle = atan(q.y, q.x);
  const r = length(q).mul(
    gnoise(vec2(angle.mul(1.6), 3.1))
      .sub(0.5)
      .mul(0.014)
      .add(1),
  );
  const disk = smoothstep(px.add(1), float(1).sub(px), r);
  const rim = smoothstep(0.82, 0.88, r).mul(smoothstep(1, 0.93, r));
  const cell = abs(fract(angle.mul(24 / TAU).add(0.5)).sub(0.5));
  // Each notch's walls slope over a few texels at least, so they are facets, never cliffs.
  const notch = smoothstep(
    px
      .mul(48 / TAU)
      .div(max(r, 0.1))
      .add(0.11),
    float(0.05),
    cell,
  ).mul(rim);
  const mask = smoothstep(0, 0.06, polygon(q, MASK).negate());
  const eyes = nearest(q, EYES);
  const groove = smoothstep(0.03, 0.012, min(nearest(q, ENGRAVING), eyes)).mul(mask);
  // The mask is gabled: a ridge down its middle, so each half takes the light its own way.
  const face = disk
    .mul(0.3)
    .add(rim.mul(0.18))
    .add(mask.mul(abs(q.x).mul(-0.3).add(0.36)))
    .sub(groove.mul(0.12))
    .sub(notch.mul(0.08));
  // The bail: a ring of round wire standing on the rim's top.
  const toBail = length(q.sub(vec2(0, SIGIL_BAIL.y)))
    .sub(SIGIL_BAIL.radius)
    .abs();
  const wire = float(1).sub(toBail.div(SIGIL_BAIL.wire).min(1).pow(2)).max(0);
  const bail = smoothstep(SIGIL_BAIL.wire, px.mul(-1.5).add(SIGIL_BAIL.wire), toBail);
  const glow = smoothstep(0.035, 0.008, eyes).mul(mask);
  return vec4(max(face, wire.sqrt().mul(0.34)), glow, 0, max(disk, bail));
}).setLayout({
  name: "kbMedallionSigil",
  type: "vec4",
  inputs: [
    { name: "q", type: "vec2" },
    { name: "px", type: "float" },
  ],
});

/** Where a point of the baked picture (UV) lies in medallion units. */
const fromBaked = (at: V2): V2 => at.mul(2).sub(1).mul(EXTENT);
/** Where a point in medallion units lies in the baked picture (UV). */
export const toBaked = (q: V2): V2 => q.div(EXTENT * 2).add(0.5);

/** An image as the relief's source: its texture, and the top of its silhouette at its centre (medallion units), where a chain leaves it. */
export interface ReliefArt {
  readonly texture: Texture;
  readonly top: number;
}

/** How opaque a texel must be to count as the silhouette. */
const OPAQUE = 128;

/**
 * The image at `url` as the relief's source (`ReliefArt`). Its top is read
 * from its centre column's alpha, so whatever hangs it, a bail or a ring,
 * is where the chain meets it.
 */
export async function loadReliefArt(url: string): Promise<ReliefArt> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`backdrop art ${url}: ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = new OffscreenCanvas(1, bitmap.height);
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("backdrop art: no 2d context");
  context.drawImage(
    bitmap,
    Math.floor(bitmap.width / 2),
    0,
    1,
    bitmap.height,
    0,
    0,
    1,
    bitmap.height,
  );
  const alpha = context.getImageData(0, 0, 1, bitmap.height).data;
  let row = 0;
  while (row < bitmap.height && (alpha[row * 4 + 3] ?? 0) < OPAQUE) row++;
  const image = new Texture(bitmap);
  image.flipY = false;
  image.needsUpdate = true;
  return { texture: image, top: (0.5 - row / bitmap.height) * 2 * EXTENT };
}

/** One clear texel, until an image is given. */
function emptyArt(): Texture {
  const empty = new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat);
  empty.needsUpdate = true;
  return empty;
}

/**
 * The edge's cleaning: the rings (texels) the height is run on over past
 * the cut, as far as the frame's slope reaches at the smallest the
 * medallion is drawn; and the alpha the silhouette is eroded between, so a
 * matted or soft edge is cut clean inside it.
 */
const EDGE = { rings: [2, 4, 7], from: 0.35, to: 0.9 } as const;
/** The cavity's two reaches (texels): grime in fine engraving, and in the broad recesses. */
const NEAR = 3;
const FAR = 14;
/** Directions the cavity looks round each point. */
const TAPS = 8;

/**
 * The relief, baked: `maps` reads the material's maps at a UV (height,
 * cavity, glow, silhouette); `setArt` takes an image as the source, or
 * null for kb's sigil; `bake` draws both passes again.
 */
export function bakedRelief(renderer: WebGPURenderer) {
  const art = texture(emptyArt());
  const useArt = uniform(0);
  const texel = 1 / SIDE;
  const source = offscreenPass(
    renderer,
    () =>
      Fn(() => {
        const at = uv();
        const sigil = sigilFn(fromBaked(at), float(texel * 2 * EXTENT));
        // An image's rows run top down; the baked picture's, bottom up.
        const image = art.sample(vec2(at.x, float(1).sub(at.y)));
        const drawn = vec4(image.r.mul(IMAGE_DEPTH), image.g, 0, image.a);
        return mix(sigil, drawn, useArt);
      })(),
    { history: false },
  );
  const edge = offscreenPass(
    renderer,
    () =>
      Fn(() => {
        const at = uv();
        const here = source.picture(at);
        let ring: F = here.x;
        for (const reach of EDGE.rings) {
          for (let k = 0; k < TAPS; k++) {
            const a = (k / TAPS) * TAU;
            const off = vec2(Math.cos(a), Math.sin(a)).mul(reach * texel);
            ring = max(ring, source.picture(at.add(off)).x);
          }
        }
        const whole = smoothstep(0.97, 1, here.w);
        return vec4(mix(ring, here.x, whole), here.y, 0, smoothstep(EDGE.from, EDGE.to, here.w));
      })(),
    { history: false },
  );
  const material = offscreenPass(
    renderer,
    () =>
      Fn(() => {
        const at = uv();
        const here = edge.picture(at);
        // How far below the relief round it a point lies: near for engraving, far for recesses.
        const round = (reach: number): F => {
          let sum: F = float(0);
          for (let k = 0; k < TAPS; k++) {
            const a = (k / TAPS) * TAU;
            const off = vec2(Math.cos(a), Math.sin(a)).mul(reach * texel);
            sum = sum.add(edge.picture(at.add(off)).x);
          }
          return sum.div(TAPS);
        };
        const cavity = clamp(
          round(NEAR).sub(here.x).mul(6).add(round(FAR).sub(here.x).mul(2.5)),
          -1,
          1,
        );
        return vec4(here.x, cavity, here.y, here.w);
      })(),
    { history: false },
  );
  source.setSize(SIDE, SIDE);
  edge.setSize(SIDE, SIDE);
  material.setSize(SIDE, SIDE);
  const bake = () => {
    source.render();
    edge.render();
    material.render();
  };
  return {
    /** The material's maps at `at` (UV): height, cavity, glow, silhouette. */
    maps: (at: V2): V4 => material.picture(at),
    /** One texel of the baked picture, in UV. */
    texel,
    setArt: (image: ReliefArt | null) => {
      if (image === null) {
        useArt.value = 0;
      } else {
        art.value = image.texture;
        useArt.value = 1;
      }
      bake();
    },
    bake,
    dispose: () => {
      source.dispose();
      edge.dispose();
      material.dispose();
    },
  };
}
export type BakedRelief = ReturnType<typeof bakedRelief>;
