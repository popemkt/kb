/**
 * A look's palette, taken from its pinned pictures: their colour space cut
 * into boxes, median cut's shape. Pure over RGBA bytes, so the page draws
 * each picture small on a canvas element and hands the bytes here, and a
 * test hands a fixture.
 * Nothing runs on the server and nothing is stored per visual: a palette for
 * every saved visual is a recorded candidate
 * (docs/research/2026-10-30-visual-composer.md §2).
 */

type Rgb = readonly [number, number, number];

/** Pixels nearly transparent say nothing about the colour of a picture. */
const OPAQUE = 128;

function pixelsOf(rgba: Uint8ClampedArray): Rgb[] {
  const out: Rgb[] = [];
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if ((rgba[i + 3] ?? 0) < OPAQUE) continue;
    out.push([rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0]);
  }
  return out;
}

/** The channel a box of pixels spreads most along, and the middle of its range. */
function widest(box: readonly Rgb[]): {
  readonly channel: 0 | 1 | 2;
  readonly span: number;
  readonly middle: number;
} {
  let best = { channel: 0 as 0 | 1 | 2, span: -1, middle: 0 };
  for (const channel of [0, 1, 2] as const) {
    let lo = 255;
    let hi = 0;
    for (const p of box) {
      lo = Math.min(lo, p[channel]);
      hi = Math.max(hi, p[channel]);
    }
    if (hi - lo > best.span) best = { channel, span: hi - lo, middle: (lo + hi) / 2 };
  }
  return best;
}

function mean(box: readonly Rgb[]): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const p of box) {
    r += p[0];
    g += p[1];
    b += p[2];
  }
  const n = box.length;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

const hex = ([r, g, b]: Rgb): string =>
  `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;

/**
 * Up to `count` swatches, `#rrggbb`, from the RGBA bytes of one or more
 * pictures: the box with the most pixels is cut at the middle of the
 * channel it spreads most along (so two clear colours never share a box, as
 * a cut at the median count would make them) until there are `count`
 * boxes or none spreads, and each box is its mean. Largest boxes first, so
 * the dominant colours lead.
 */
export function paletteOf(rgba: Uint8ClampedArray, count = 6): readonly string[] {
  const all = pixelsOf(rgba);
  if (all.length === 0) return [];
  let boxes: Rgb[][] = [all];
  while (boxes.length < count) {
    // The largest box that still spreads: one of a single colour cannot be cut.
    const cuttable = boxes
      .map((box) => ({ box, cut: widest(box) }))
      .filter(({ cut }) => cut.span > 0)
      .toSorted((a, b) => b.box.length - a.box.length)[0];
    if (cuttable === undefined) break;
    const { box, cut } = cuttable;
    const low = box.filter((p) => p[cut.channel] <= cut.middle);
    const high = box.filter((p) => p[cut.channel] > cut.middle);
    boxes = [...boxes.filter((b) => b !== box), low, high];
  }
  const swatches = boxes.toSorted((a, b) => b.length - a.length).map((box) => hex(mean(box)));
  return [...new Set(swatches)];
}
