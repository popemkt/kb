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
 * Its passes run only when the source changes, one concept each:
 *
 * 1. **The source**, as height, glow and silhouette.
 * 2. **Its edge cleaned** (`EDGE`): the silhouette eroded past any matte its
 *    edge carries, and the height run on flat past the silhouette's cut,
 *    the highest round each point there, so the frame's slope never finds a
 *    cliff at the cut to light as an outline.
 * 3. **The sockets** (`SOCKET`): wherever the relief glows, a socket sunk
 *    into the height round it, a bowl whose walls rise to the metal past
 *    it, so a glow is a light deep in the relief and never a decal on it;
 *    and how deep inside the glow a point lies (whole at `SOCKET.heart` in
 *    from its edge or deeper).
 * 4. **The material's maps**: height, cavity (how far a point lies below
 *    the relief round it, where grime and patina collect), heat (0 where
 *    nothing glows, ½ where the glow is whole at its edge, 1 at its heart:
 *    a glow's core is hottest deepest in it, whatever its size) and
 *    silhouette, kept with their mip chain. The frame takes the relief's
 *    slope from the baked height over the pixel's footprint, from the mip
 *    level that footprint reads.
 * 5. **The sockets' light** (`EYE_LIGHT`), from the glow gathered coarse
 *    (`emitters`): at each point, the light reaching it from every glowing
 *    point near it, a point light deep in its socket, as a flux (its
 *    direction and its strength, falling with the square of distance) and
 *    its strength from every side; a light the relief between them stands
 *    above is hidden from it, so a brow shades what lies past it. The frame
 *    lights the steel by it as it lights it by any light.
 */
import {
  Fn,
  If,
  Loop,
  abs,
  atan,
  clamp,
  dot,
  float,
  fract,
  int,
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
  vec3,
  vec4,
} from "three/tsl";
import { DataTexture, RGBAFormat, Texture, type WebGPURenderer } from "three/webgpu";
import { offscreenPass, type OffscreenPass, type TslNode } from "@kb/scene-gpu";
import { gnoise } from "../gpu/noise";
import { TAU } from "../scene/math";
import { ENGRAVING, EYES, MASK, type Point, type Stroke } from "./medallion";

type F = TslNode<"float">;
type V2 = TslNode<"vec2">;
type V3 = TslNode<"vec3">;
type V4 = TslNode<"vec4">;

/** How far the baked picture reaches from the centre (medallion units): an image's round body is 0.4 of its width. */
export const EXTENT = 1.25;
/** The baked picture's side (texels): the disk is about 800 of them across, finer than a device pixel at any width it is shown. */
const SIDE = 1024;
/** How far a unit of height stands off the face, in medallion units: the frame's normals and the sockets' light both read it. */
export const RISE = 0.6;
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
const nearest = (q: V2, strokes: readonly Stroke[]): F =>
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
  // Each eye glows as an almond along its stroke, its socket sunk round it (the bake's `SOCKET`).
  const glow = smoothstep(0.055, 0.02, eyes).mul(mask);
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

/** A length in medallion units, in texels of the baked picture. */
const toTexels = (units: number): number => (units / (2 * EXTENT)) * SIDE;
/** One texel of the baked picture, in UV. */
const TEXEL = 1 / SIDE;

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
 * A socket: how far its walls reach past its glow (medallion units), how
 * deep it is sunk (height), and the rings (fractions of the reach) and taps
 * it is drawn over; and how far in from a glow's edge its heat is whole
 * (medallion units).
 */
const SOCKET = {
  reach: 0.07,
  depth: 0.16,
  rings: [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1],
  taps: 16,
  heart: 0.04,
} as const;
/**
 * The sockets' light: the glow gathered on a coarse grid (`emitters`, texels
 * a side), how far a light reaches (medallion units), how far it sits above
 * its socket's floor (height), how near a point it is never nearer
 * (medallion units, so it never meets a point), and the light map's side.
 */
const EYE_LIGHT = { emitters: 128, reach: 0.26, lift: 0.04, near: 0.014, side: 256 } as const;

/** One glowing point's light at a point: its flux (direction and strength) and its strength from every side. */
function shine(toward: V3, amount: F): V4 {
  const d2 = dot(toward, toward).add(EYE_LIGHT.near * EYE_LIGHT.near);
  return vec4(toward.mul(amount.div(d2.mul(d2.sqrt()))), amount.div(d2));
}

/**
 * The sockets' passes over the cleaned relief (`edge`): the height with a
 * socket sunk round each glow, and how deep inside the glow each point
 * lies (`socket`); the glow gathered on a coarse grid (`emitters`); and the
 * light its cells shed on every point near them (`light`, kept with its mip
 * chain, as the frame reads it).
 */
function bakedSockets(renderer: WebGPURenderer, edge: OffscreenPass) {
  const texel = TEXEL;
  const socket = offscreenPass(
    renderer,
    () =>
      Fn(() => {
        const at = uv();
        const here = edge.picture(at);
        // The bowl: the glow round each point, blurred, a ring's glow counting less the further it
        // lies, so the walls fall smoothly from the metal past the reach to the floor under the glow,
        // whole where half the round is glow (a glow's edge). How deep inside: the glow's least on
        // each of the rings, eroded, so it is whole only well in. Each sum is a variable, so the
        // shader stays flat however many taps there are.
        const round = here.y.toVar();
        const inside = float(0).toVar();
        let weight = 1;
        for (const ring of SOCKET.rings) {
          const least = here.y.toVar();
          for (let k = 0; k < SOCKET.taps; k++) {
            const a = ((k + ring) / SOCKET.taps) * TAU;
            const dir = vec2(Math.cos(a), Math.sin(a)).mul(texel);
            const near = 1 - ring * ring;
            round.addAssign(
              edge.picture(at.add(dir.mul(toTexels(SOCKET.reach * ring)))).y.mul(near),
            );
            weight += near;
            least.assign(
              min(least, edge.picture(at.add(dir.mul(toTexels(SOCKET.heart * ring)))).y),
            );
          }
          inside.addAssign(least);
        }
        const sunk = smoothstep(0, 0.5, round.div(weight)).mul(SOCKET.depth);
        return vec4(here.x.sub(sunk), here.y, inside.div(SOCKET.rings.length), here.w);
      })(),
    { history: false },
  );
  // The glow gathered on a coarse grid: how much of each cell glows, and how high its glow lies.
  const emitters = offscreenPass(
    renderer,
    () =>
      Fn(() => {
        const at = uv();
        const span = SIDE / EYE_LIGHT.emitters;
        const glow = float(0).toVar();
        const height = float(0).toVar();
        for (let x = 0; x < span; x++) {
          for (let y = 0; y < span; y++) {
            const off = vec2(x + 0.5 - span / 2, y + 0.5 - span / 2).mul(texel);
            const tap = socket.picture(at.add(off)).toVar();
            glow.addAssign(tap.y);
            height.addAssign(tap.y.mul(tap.x));
          }
        }
        return vec4(glow.div(span * span), height.div(glow.max(1e-4)), 0, 1);
      })(),
    { history: false },
  );
  const light = offscreenPass(
    renderer,
    () =>
      Fn(() => {
        const at = uv();
        const ground = socket.picture(at).x.add(0.004);
        const cell = 1 / EYE_LIGHT.emitters;
        const cells = Math.ceil(toTexels(EYE_LIGHT.reach) / (SIDE / EYE_LIGHT.emitters));
        // A cell's glow lights as much as its area does.
        const area = (cell * 2 * EXTENT) ** 2;
        const sum = vec4(0, 0, 0, 0).toVar();
        Loop(
          { start: int(-cells), end: int(cells + 1), type: "int", condition: "<" },
          { start: int(-cells), end: int(cells + 1), type: "int", condition: "<" },
          ({ i, j }: { readonly i: TslNode<"int">; readonly j: TslNode<"int"> }) => {
            const from = at.add(vec2(float(i), float(j)).mul(cell));
            const cellGlow = emitters.picture(from);
            If(cellGlow.x.greaterThan(1e-3), () => {
              const offset = from.sub(at).mul(2 * EXTENT);
              const reach = smoothstep(EYE_LIGHT.reach, EYE_LIGHT.reach * 0.6, length(offset));
              const lamp = cellGlow.y.add(EYE_LIGHT.lift);
              // Hidden where the relief between them stands above the line from the point to it.
              let seen: F = float(1);
              for (const t of [1 / 3, 2 / 3]) {
                const over = mix(ground, lamp, t).sub(socket.picture(mix(at, from, t)).x);
                seen = seen.mul(smoothstep(-0.015, 0.01, over));
              }
              const toward = vec3(offset, lamp.sub(ground).mul(RISE));
              sum.addAssign(shine(toward, cellGlow.x.mul(area).mul(reach).mul(seen)));
            });
          },
        );
        return sum;
      })(),
    { history: false, mipmapped: true },
  );
  return { socket, emitters, light };
}

/**
 * The relief, baked: `maps` reads the material's maps at a UV (height,
 * cavity, heat, silhouette) and `light` the sockets' light; `setArt` takes
 * an image as the source, or null for kb's sigil; `bake` draws every pass
 * again.
 */
export function bakedRelief(renderer: WebGPURenderer) {
  const art = texture(emptyArt());
  const useArt = uniform(0);
  const texel = TEXEL;
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
  const { socket, emitters, light } = bakedSockets(renderer, edge);
  const material = offscreenPass(
    renderer,
    () =>
      Fn(() => {
        const at = uv();
        const here = socket.picture(at);
        // How far below the relief round it a point lies: near for engraving, far for recesses.
        const round = (reach: number): F => {
          let sum: F = float(0);
          for (let k = 0; k < TAPS; k++) {
            const a = (k / TAPS) * TAU;
            const off = vec2(Math.cos(a), Math.sin(a)).mul(reach * texel);
            sum = sum.add(socket.picture(at.add(off)).x);
          }
          return sum.div(TAPS);
        };
        const cavity = clamp(
          round(NEAR).sub(here.x).mul(6).add(round(FAR).sub(here.x).mul(2.5)),
          -1,
          1,
        );
        return vec4(here.x, cavity, here.y.add(here.z).mul(0.5), here.w);
      })(),
    // The frame reads the maps at a fifth of their size or less: their mip chain filters each read
    // over the pixel's footprint, so the silhouette, the engraving's edges and the slope are
    // antialiased at their source rather than sampled into stairs.
    { history: false, mipmapped: true },
  );
  source.setSize(SIDE, SIDE);
  edge.setSize(SIDE, SIDE);
  socket.setSize(SIDE, SIDE);
  emitters.setSize(EYE_LIGHT.emitters, EYE_LIGHT.emitters);
  light.setSize(EYE_LIGHT.side, EYE_LIGHT.side);
  material.setSize(SIDE, SIDE);
  const passes = [source, edge, socket, emitters, light, material];
  const bake = () => {
    for (const pass of passes) pass.render();
  };
  return {
    /** The material's maps at `at` (UV): height, cavity, heat (how hot a glow is there), silhouette. */
    maps: (at: V2): V4 => material.picture(at),
    /**
     * The sockets' light at `at` (UV): its flux (xyz, medallion units, z off
     * the face; its length the light's strength on a face square to it) and
     * its strength from every side (w).
     */
    light: (at: V2): V4 => light.picture(at),
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
      for (const pass of passes) pass.dispose();
    },
  };
}
export type BakedRelief = ReturnType<typeof bakedRelief>;
