/**
 * A city skyline drawn as SVG paths, original and deterministic: a seeded
 * walk of towers along the ground, each crowned the Art Nouveau way (a
 * dome, an onion bulb, a spire with its needle, a ringed tower, a stepped
 * block) with arched bridges between some of them, and the lit windows of
 * the nearest layer. Every value is computed here once per layer, at
 * module load; nothing is drawn per frame.
 */

/** Width and ground of the drawing, in the SVG's own units. */
export const SKYLINE_W = 1600;
export const SKYLINE_H = 320;

export interface SkylineLayer {
  /** One path: every tower, crown and bridge, filled as one silhouette. */
  readonly d: string;
  /** Lit windows: their boxes, and which of them may twinkle. */
  readonly windows: readonly { x: number; y: number; w: number; h: number; twinkle: boolean }[];
}

/** mulberry32: a small seeded generator, so a layer is the same on every load. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

type Crown = "dome" | "onion" | "spire" | "ring" | "step" | "flat";
const CROWNS: readonly Crown[] = [
  "dome",
  "onion",
  "spire",
  "ring",
  "step",
  "flat",
  "spire",
  "dome",
];

/** One tower's outline, from the ground up and back down, as a closed subpath. */
function tower(x: number, w: number, top: number, crown: Crown): string {
  const g = SKYLINE_H;
  const right = r1(x + w);
  const mid = r1(x + w / 2);
  x = r1(x);
  top = r1(top);
  switch (crown) {
    case "dome":
      return `M${x} ${g}V${top}A${r1(w / 2)} ${r1(w / 2.2)} 0 0 1 ${right} ${top}V${g}Z`;
    case "onion":
      return (
        `M${x} ${g}V${top}` +
        `C${x} ${r1(top - w * 0.55)} ${r1(mid - w * 0.12)} ${r1(top - w * 0.6)} ${mid} ${r1(top - w * 1.25)}` +
        `C${r1(mid + w * 0.12)} ${r1(top - w * 0.6)} ${right} ${r1(top - w * 0.55)} ${right} ${top}V${g}Z`
      );
    case "spire":
      return (
        `M${x} ${g}V${top}L${r1(mid - 1)} ${r1(top - w * 1.4)}V${r1(top - w * 2.4)}` +
        `H${r1(mid + 1)}V${r1(top - w * 1.4)}L${right} ${top}V${g}Z`
      );
    case "ring": {
      const r = r1(Math.min(w * 0.3, 14));
      const cy = r1(top - r - 3);
      return (
        `M${x} ${g}V${top}H${r1(mid - 1.5)}V${r1(cy + r)}H${r1(mid + 1.5)}V${top}H${right}V${g}Z` +
        `M${r1(mid - r)} ${cy}A${r} ${r} 0 1 0 ${r1(mid + r)} ${cy}A${r} ${r} 0 1 0 ${r1(mid - r)} ${cy}Z` +
        `M${r1(mid - r + 2.5)} ${cy}A${r1(r - 2.5)} ${r1(r - 2.5)} 0 1 1 ${r1(mid + r - 2.5)} ${cy}A${r1(r - 2.5)} ${r1(r - 2.5)} 0 1 1 ${r1(mid - r + 2.5)} ${cy}Z`
      );
    }
    case "step":
      return (
        `M${x} ${g}V${top}H${r1(x + w * 0.18)}V${r1(top - w * 0.35)}H${r1(x + w * 0.34)}` +
        `V${r1(top - w * 0.7)}H${r1(right - w * 0.34)}V${r1(top - w * 0.35)}H${r1(right - w * 0.18)}` +
        `V${top}H${right}V${g}Z`
      );
    case "flat":
      return `M${x} ${g}V${top}H${right}V${g}Z`;
    default:
      crown satisfies never;
      return "";
  }
}

/** An arched bridge between two towers' walls, at `y`, as a closed subpath. */
function bridge(from: number, to: number, y: number): string {
  const span = to - from;
  return (
    `M${r1(from)} ${r1(y)}H${r1(to)}V${r1(y + 10)}` +
    `Q${r1(from + span / 2)} ${r1(y - 4)} ${r1(from)} ${r1(y + 10)}Z`
  );
}

/**
 * A layer of the city: `seed` picks it, `rise` and `spread` say how tall
 * its towers stand (a share of the drawing's height), `width` how broad,
 * and `windows` how many of its walls are lit.
 */
export function skylineLayer(
  seed: number,
  rise: readonly [number, number],
  width: readonly [number, number],
  windows: number,
): SkylineLayer {
  const next = random(seed);
  const span = (lo: number, hi: number) => lo + (hi - lo) * next();
  const parts: string[] = [];
  const lit: { x: number; y: number; w: number; h: number; twinkle: boolean }[] = [];
  let x = -span(0, 30);
  let previous: { right: number; top: number } | null = null;
  while (x < SKYLINE_W) {
    const w = span(width[0], width[1]);
    // A tall tower now and then, so the line has landmarks, not a comb.
    const landmark = next() < 0.12;
    // Crowns rise above the wall by up to 2.4 widths: keep every one inside
    // the drawing, so no roof is cut flat by its top edge.
    const h = Math.min(
      SKYLINE_H * span(rise[0], rise[1]) * (landmark ? 1.45 : 1),
      SKYLINE_H - w * 2.5 - 4,
    );
    const top = SKYLINE_H - h;
    const crown = CROWNS[Math.floor(next() * CROWNS.length)] ?? "flat";
    parts.push(tower(x, w, top, crown));
    if (previous !== null && next() < 0.28) {
      const y = Math.max(previous.top, top) + span(18, 46);
      if (y < SKYLINE_H - 20) parts.push(bridge(previous.right - 1, x + 1, y));
    }
    for (let row = top + 14; row < SKYLINE_H - 10; row += 13) {
      for (let col = x + 5; col < x + w - 7; col += 9) {
        if (next() < windows) {
          lit.push({ x: r1(col), y: r1(row), w: 3, h: 5, twinkle: next() < 0.18 });
        }
      }
    }
    previous = { right: x + w, top };
    x += w + span(-4, 26);
  }
  return { d: parts.join(""), windows: lit };
}

/** The far city: tall, pale, unlit. */
export const FAR_CITY = skylineLayer(7, [0.34, 0.62], [22, 54], 0);
/** The near city: lower and broader, with lit windows. */
export const NEAR_CITY = skylineLayer(31, [0.16, 0.38], [34, 80], 0.07);
