/**
 * The Disc field backdrop's picture as data (the scene: `disc-field-scene.ts`;
 * its shader: `disc-field-shader.ts`): a vineyard lane painted in discs, the
 * pointillist look of a painted wine estate. Nothing is a mesh. The lane is
 * a set of surfaces (foliage clumps in rows, their stems, grapes and
 * blooms tucked into them, a dusty path between grassy lanes), and each is
 * sampled into points that carry their own lit colour; every point becomes
 * one flat, hard-edged disc, its size from perspective and a random draw.
 *
 * Light is baked here, once: a low sun at the upper right (`SUN`) shades
 * each clump by its normal, and the clump's own foot darkens it (occlusion
 * by height). Colour comes from authored ramps (`FOLIAGE`, …), dark to
 * light, never from a lit material.
 *
 * The cloud is shuffled, so any prefix of it is a uniform subset: a frame
 * that must spend less draws fewer discs (`DiscCloud`), never a corner of
 * the lane.
 */
import type { Rng } from "../scene/rng";
import type { Variation } from "../scene/seed";

/** A display-space colour, 0–1 per channel. */
export type Rgb = readonly [number, number, number];

/** A colour ramp, dark to light: its stops evenly spaced over 0–1. */
export type Ramp = readonly Rgb[];

const rgb = (hex: string): Rgb => [
  Number.parseInt(hex.slice(1, 3), 16) / 255,
  Number.parseInt(hex.slice(3, 5), 16) / 255,
  Number.parseInt(hex.slice(5, 7), 16) / 255,
];
const ramp = (...stops: string[]): Ramp => stops.map(rgb);

/** The colour `t` (0–1, clamped) of the way along `stops`. */
export function rampAt(stops: Ramp, t: number): Rgb {
  const last = stops.length - 1;
  const at = Math.min(Math.max(t, 0), 1) * last;
  const i = Math.min(Math.floor(at), last - 1);
  const k = at - i;
  const a = stops[i] ?? [0, 0, 0];
  const b = stops[i + 1] ?? a;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** The vine leaves: five greens from olive to lime, each up to a pale, sunlit cream. */
export const FOLIAGE: readonly Ramp[] = [
  ramp("#5f8a24", "#93b13c", "#c2d45c", "#e9f08f", "#fdfdc9"),
  ramp("#7a9055", "#a2b873", "#c6d392", "#e2e9b8", "#f7f7da"),
  ramp("#66771f", "#8e9d30", "#b9bd48", "#dedc72", "#f9f4ad"),
  ramp("#477a1c", "#68982c", "#92bd40", "#bddc62", "#e8f4a4"),
  ramp("#8a8f3a", "#b3b653", "#d3d278", "#ebe6a0", "#faf3c4"),
];
/** Vine stems and posts: weathered wood. */
const WOOD = ramp("#6b4330", "#9a6a4c", "#c18f6c", "#e0b793", "#f4dcc3");
/** The path's dust: terracotta to a pale peach. */
const DUST = ramp("#b98762", "#d8a983", "#e8c29a", "#f4d7b0", "#fcebd0");
/** The grass between the rows. */
const GRASS = ramp("#7d9035", "#a3b04a", "#c6cc70", "#e3e39b", "#f6f3c6");
/** Grapes: the one cool accent. */
const GRAPE = ramp("#4b2f66", "#6c4687", "#8f68a8", "#b697c7", "#d9c3e2");
/** Wild flowers in the grass: a rose and a marigold. */
const BLOOMS: readonly Ramp[] = [
  ramp("#c2405c", "#e0607a", "#f08fa0", "#f8bcc6", "#fde0e4"),
  ramp("#c8561f", "#e57f38", "#f0a45f", "#f8c98f", "#fde6c4"),
];

/** Where the sun stands: high at the right, a little toward the eye. */
const SUN = (() => {
  const v = [0.7, 0.62, 0.25] as const;
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n] as const;
})();

/**
 * The discs: for each, its place (world units), its colour (display
 * space), four uniform draws (its size, its speck's size, its threshold against
 * the silhouette's spray, its phase) and how freely it sways (0–1.5).
 */
export interface DiscCloud {
  readonly count: number;
  readonly place: Float32Array;
  readonly colour: Float32Array;
  readonly draw: Float32Array;
  readonly sway: Float32Array;
}

/** Collects samples, then shuffles them into a cloud whose every prefix is a fair subset. */
class CloudBuilder {
  private readonly place: number[] = [];
  private readonly colour: number[] = [];
  private readonly sways: number[] = [];

  get count(): number {
    return this.sways.length;
  }

  add(x: number, y: number, z: number, c: Rgb, sway: number): void {
    this.place.push(x, y, z);
    this.colour.push(c[0], c[1], c[2]);
    this.sways.push(sway);
  }

  build(rng: Rng): DiscCloud {
    const count = this.count;
    const order = Uint32Array.from({ length: count }, (_, i) => i);
    for (let i = count - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const swap = order[i] ?? i;
      order[i] = order[j] ?? j;
      order[j] = swap;
    }
    const cloud: DiscCloud = {
      count,
      place: new Float32Array(count * 3),
      colour: new Float32Array(count * 3),
      draw: new Float32Array(count * 4),
      sway: new Float32Array(count),
    };
    order.forEach((from, i) => {
      for (let k = 0; k < 3; k++) {
        cloud.place[i * 3 + k] = this.place[from * 3 + k] ?? 0;
        cloud.colour[i * 3 + k] = this.colour[from * 3 + k] ?? 0;
      }
      for (let k = 0; k < 4; k++) cloud.draw[i * 4 + k] = rng.next();
      cloud.sway[i] = this.sways[from] ?? 0;
    });
    return cloud;
  }
}

/** A lattice hash in [0, 1): the same for the same corner, every time. */
function lattice(x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Value noise in [0, 1]. */
function noise3(x: number, y: number, z: number): number {
  const [xi, yi, zi] = [Math.floor(x), Math.floor(y), Math.floor(z)];
  const [u, v, w] = [smooth(x - xi), smooth(y - yi), smooth(z - zi)];
  const plane = (k: number) =>
    lerp(
      lerp(lattice(xi, yi, k), lattice(xi + 1, yi, k), u),
      lerp(lattice(xi, yi + 1, k), lattice(xi + 1, yi + 1, k), u),
      v,
    );
  return lerp(plane(zi), plane(zi + 1), w);
}

/** Fractal value noise in [0, 1]: `octaves` a factor of two apart. */
function fbm3(x: number, y: number, z: number, octaves = 3): number {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * noise3(x * frequency, y * frequency, z * frequency);
    amplitude /= 2;
    frequency *= 2;
  }
  return sum / (1 - 0.5 ** octaves);
}

/** The ground's height at depth `z`: it rises away from the eye, so the far rows fill the frame's middle. */
export const groundAt = (z: number) => Math.min(Math.max(0, -z - 8), 85) * 0.24;

/** A rounded mass sampled on its surface: a clump of leaves, a bunch of grapes, a flower. */
interface Clump {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rx: number;
  readonly ry: number;
  readonly rz: number;
  readonly ramp: Ramp;
  /** Where its own noise is read, so no two clumps are lumpy alike. */
  readonly seed: number;
  /** How far up or down its ramp it sits. */
  readonly tone: number;
  /** The ground under it: nothing is drawn below. */
  readonly floor: number;
}

/** `n` samples on `clump`'s lumpy surface, lit by the sun and darkened toward its foot. */
function sampleClump(cloud: CloudBuilder, rng: Rng, clump: Clump, n: number): void {
  for (let i = 0; i < n; i++) {
    const up = rng.next() * 2 - 1;
    const turn = rng.next() * Math.PI * 2;
    const ring = Math.sqrt(1 - up * up);
    const [dx, dy, dz] = [ring * Math.cos(turn), up, ring * Math.sin(turn)];
    const bump =
      1 + (fbm3(dx * 2.2 + clump.seed, dy * 2.2, dz * 2.2 + clump.seed * 0.7) - 0.5) * 0.5;
    const x = clump.x + dx * clump.rx * bump;
    const y = clump.y + dy * clump.ry * bump;
    const z = clump.z + dz * clump.rz * bump;
    if (y < clump.floor) continue;
    const lit = (dx * SUN[0] + dy * SUN[1] + dz * SUN[2]) * 0.5 + 0.5;
    const occlusion = Math.min(1, Math.max(0, (y - clump.floor) / (clump.ry * 1.3)));
    const grain = fbm3(x * 2.1, y * 2.1, z * 2.1) - 0.5;
    const t = 0.08 + 0.8 * lit * (0.45 + 0.55 * occlusion) + grain * 0.45 + clump.tone;
    cloud.add(x, y, z, rampAt(clump.ramp, t), 0.5 + occlusion);
  }
}

const pickOf = <T>(rng: Rng, options: readonly T[]): T => {
  const picked = options[Math.floor(rng.next() * options.length)];
  if (picked === undefined) throw new Error("pickOf: no options");
  return picked;
};

/** How the load lays its vineyard out: drawn from its variation by name. */
interface Planting {
  /** The first row's distance from the path, and the rows' spacing. */
  readonly first: number;
  readonly spacing: number;
  /** How the right-hand rows lean toward the sun on their ramps. */
  readonly sunward: number;
  readonly grapes: number;
  readonly blooms: number;
}

function plantingOf(vary: Variation): Planting {
  return {
    first: vary.range("disc.first", 1.5, 1.9),
    spacing: vary.range("disc.spacing", 2.6, 3.2),
    sunward: vary.range("disc.sunward", 0.08, 0.18),
    grapes: Math.round(vary.range("disc.grapes", 50, 90)),
    blooms: Math.round(vary.range("disc.blooms", 60, 110)),
  };
}

/** The foliage: rows of clumps converging down the lane, great masses at the front, trees far off. */
function foliage(rng: Rng, plant: Planting): Clump[] {
  const clumps: Clump[] = [];
  for (const side of [-1, 1]) {
    for (let row = 0; row < 5; row++) {
      const x0 = side * (plant.first + row * plant.spacing);
      for (let z = 4.5; z > -150; z -= 0.62 + rng.next() * 0.25 + Math.max(0, -z) * 0.01) {
        const h = 0.75 + rng.next() * 0.45 + (row === 0 ? 0.15 : 0);
        clumps.push({
          x: x0 + (rng.next() - 0.5) * 0.35,
          y: h + groundAt(z),
          z,
          rx: 0.55 + rng.next() * 0.25,
          ry: h,
          rz: 0.55 + rng.next() * 0.2,
          ramp: pickOf(rng, FOLIAGE),
          seed: rng.next() * 50,
          tone: (rng.next() - 0.5) * 0.18 + (side > 0 ? plant.sunward : 0),
          floor: groundAt(z) + 0.02,
        });
      }
    }
  }
  // The great masses at the front: the largest discs, and the frame's foreground.
  for (const [x, z, k] of [
    [-2.7, 3.2, 1.6],
    [-3.4, 1.4, 1.35],
    [2.9, 3.5, 1.7],
    [3.7, 1.8, 1.4],
    [-1.8, 5.0, 1.0],
    [2.2, 5.2, 1.1],
  ] as const) {
    const s = k * (0.85 + rng.next() * 0.3);
    const tone = x > 0 ? plant.sunward : -0.02;
    clumps.push({
      x,
      y: s * 0.8,
      z,
      rx: s,
      ry: s * 0.95,
      rz: s,
      ramp: pickOf(rng, FOLIAGE),
      seed: rng.next() * 50,
      tone,
      floor: 0.02,
    });
  }
  for (let i = 0; i < 26; i++) {
    const far = -96 - rng.next() * 44;
    clumps.push({
      x: (rng.next() - 0.5) * 120,
      y: 3.5 + rng.next() * 2 + groundAt(-110),
      z: far,
      rx: 3 + rng.next() * 2,
      ry: 3 + rng.next() * 2.4,
      rz: 3 + rng.next() * 2,
      ramp: pickOf(rng, FOLIAGE),
      seed: rng.next() * 50,
      tone: 0.1,
      floor: groundAt(-110) - 1,
    });
  }
  return clumps;
}

/** Each clump's share of the foliage's discs: its surface, less with distance, so far rows are covered without waste. */
function shares(clumps: readonly Clump[]): number[] {
  const weights = clumps.map((c) => {
    const area = c.rx * c.rz + c.rx * c.ry + c.ry * c.rz;
    const away = Math.hypot(c.x, c.z - 7) + 1;
    return area / (1 + (away / 9) ** 1.25);
  });
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => w / sum);
}

/** How the details' discs are shared: the stems, the grapes, the flowers. */
const DETAIL = { stems: 0.37, grapes: 0.37, blooms: 0.26 } as const;

/**
 * Stems at the rows' feet, and the grapes and flowers tucked in among the
 * leaves: about `n` discs, the stems' thinning with distance as the
 * foliage's does.
 */
function details(cloud: CloudBuilder, rng: Rng, plant: Planting, n: number): void {
  const stems: { readonly x: number; readonly z: number }[] = [];
  for (const side of [-1, 1]) {
    for (let row = 0; row < 3; row++) {
      for (let z = 4; z > -40; z -= 1.3)
        stems.push({ x: side * (plant.first + row * plant.spacing), z });
    }
  }
  const near = stems.map(({ z }) => 1 / (1 + Math.abs(z) / 6));
  const nearest = near.reduce((a, b) => a + b, 0);
  stems.forEach(({ x, z }, i) => {
    const stem = { x, y: 0.28 + groundAt(z), z, rx: 0.07, ry: 0.28, rz: 0.07 };
    sampleClump(
      cloud,
      rng,
      { ...stem, ramp: WOOD, seed: rng.next() * 9, tone: 0, floor: groundAt(z) },
      Math.max(4, Math.round((n * DETAIL.stems * (near[i] ?? 0)) / nearest)),
    );
  });
  const perBunch = Math.max(6, Math.round((n * DETAIL.grapes) / plant.grapes));
  for (let i = 0; i < plant.grapes; i++) {
    const side = rng.next() < 0.55 ? 1 : -1;
    const z = 4 - rng.next() * 26;
    const x =
      side * (plant.first - 0.3 + Math.floor(rng.next() * 3) * plant.spacing) +
      (rng.next() - 0.5) * 0.8;
    const k = 0.1 + rng.next() * 0.12;
    const at = { x, y: 0.5 + rng.next() * 0.6 + groundAt(z), z, rx: k, ry: k, rz: k };
    sampleClump(
      cloud,
      rng,
      { ...at, ramp: GRAPE, seed: rng.next() * 9, tone: 0, floor: groundAt(z) },
      perBunch,
    );
  }
  const perBloom = Math.max(4, Math.round((n * DETAIL.blooms) / plant.blooms));
  for (let i = 0; i < plant.blooms; i++) {
    // A flower never stands on the path: it is drawn at the lane's edge instead.
    const across = (rng.next() - 0.5) * 9;
    const x = Math.sign(across) * Math.max(0.5, Math.abs(across));
    const z = 4 - rng.next() * 26;
    const k = 0.07 + rng.next() * 0.1;
    const at = { x, y: 0.08 + rng.next() * 0.55 + groundAt(z), z, rx: k, ry: k, rz: k };
    sampleClump(
      cloud,
      rng,
      { ...at, ramp: pickOf(rng, BLOOMS), seed: rng.next() * 9, tone: 0, floor: groundAt(z) },
      perBloom,
    );
  }
}

/** The ground: a peach dust path down the middle, grass in the lanes, denser near the eye. */
function ground(cloud: CloudBuilder, rng: Rng, plant: Planting, n: number): void {
  for (let i = 0; i < n; i++) {
    const z = 6 - 150 * rng.next() ** 1.9;
    const half = 3 + (6 - z) * 0.6;
    const x = (rng.next() * 2 - 1) * half;
    const across = (Math.abs(x) - plant.first) / plant.spacing;
    const lane = Math.abs(across % 1);
    const inRow = Math.abs(x) > 1.2 && Math.abs(Math.sin(across * Math.PI)) < 0.32;
    const broad = fbm3(x * 0.8, 0, z * 0.5);
    const fine = fbm3(x * 3.1 + 9, 0, z * 2.3, 2);
    const dust = rampAt(DUST, 0.35 + 0.55 * broad + (fine - 0.5) * 0.3);
    const grassy =
      Math.max(0, Math.min(1, (Math.abs(x) - 1) * 0.6 + (fine - 0.5) * 0.8)) *
      (inRow || lane > 0.5 ? 0.85 : 0.45);
    const grass = rampAt(GRASS, 0.3 + 0.6 * broad);
    const c: Rgb = [
      lerp(dust[0], grass[0], grassy),
      lerp(dust[1], grass[1], grassy),
      lerp(dust[2], grass[2], grassy),
    ];
    cloud.add(x, groundAt(z), z, c, 0.15);
  }
}

/** The discs' shares: the leaves, the ground, and the details (stems, grapes, flowers). */
const SHARE = { foliage: 0.545, ground: 0.32, details: 0.135 } as const;

/** This load's vineyard: about `total` discs, laid out by `vary`. */
export function bakeVineyard(vary: Variation, total: number): DiscCloud {
  const rng = vary.stream("disc.cloud");
  const plant = plantingOf(vary);
  const cloud = new CloudBuilder();
  const clumps = foliage(rng, plant);
  shares(clumps).forEach((share, i) => {
    const clump = clumps[i];
    if (clump !== undefined)
      sampleClump(cloud, rng, clump, Math.max(6, Math.round(total * SHARE.foliage * share)));
  });
  details(cloud, rng, plant, Math.round(total * SHARE.details));
  ground(cloud, rng, plant, Math.round(total * SHARE.ground));
  return cloud.build(rng);
}
