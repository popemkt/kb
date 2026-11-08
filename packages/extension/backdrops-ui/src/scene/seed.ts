/**
 * A backdrop's seed and the variation drawn from it (DESIGN-UI.md →
 * Page-head backdrops → Variation). Every load of the page shows a backdrop
 * a little differently: where its subject sits, how large, its hue, where
 * its motion starts. Each way it may differ is a named draw within a range
 * its art direction allows, so every variation still reads as the picture.
 *
 * - The seed is the load's (`useLoadSeed`, `@kb/ui-sdk`): a scene mounted
 *   again (the head remounting, Settings' cards) shows the same variation
 *   as before, and `?backdrop-seed=<n>` pins it; a test passes its own.
 * - A seed the owner pins (the seed knob) is the scene's whatever else
 *   holds, moving or still.
 * - Reduced motion otherwise shows the one curated still; which of a
 *   backdrop's variants a load shows is the slot's draw from the load's
 *   seed even so (`BackdropProps.variant`), so a still is composed at
 *   random as every load is.
 * - `variation(seed)` draws by name. Each name has a stream of its own, so a
 *   draw added or removed never moves another, and a name drawn twice is the
 *   same value.
 */
import { useLoadSeed } from "@kb/ui-sdk";
import { seededRng, type Rng } from "./rng";

/** A still is curated: reduced motion always shows the same composition. */
const STILL_SEED = 7;

/**
 * The seed a backdrop's scene is made from: the one the owner pinned (its
 * seed knob, `SEED_KNOB`; null, none), else this load's (`load`), or under
 * reduced motion the curated still. A pin is the owner's word, so it holds
 * moving or still.
 */
export function backdropSeed(load: number, reducedMotion: boolean, pinned: number | null): number {
  return pinned ?? (reducedMotion ? STILL_SEED : load);
}

/** The seed a backdrop's scene is made from now (`backdropSeed`). */
export function useBackdropSeed(reducedMotion: boolean, pinned: number | null): number {
  return backdropSeed(useLoadSeed(), reducedMotion, pinned);
}

/** The ways a backdrop's scene may differ from one load to the next, each drawn by name. */
export interface Variation {
  /** A number in `[low, high)`. */
  readonly range: (name: string, low: number, high: number) => number;
  /** One of `options`. */
  readonly pick: <T>(name: string, options: readonly [T, ...T[]]) => T;
  /** 1 or -1: which way something turns. */
  readonly sign: (name: string) => 1 | -1;
  /** Where on its cycle a motion starts, in `[0, 2π)`. */
  readonly phase: (name: string) => number;
  /** For a layout that draws many values: a stream of its own. */
  readonly stream: (name: string) => Rng;
}

/** FNV-1a over a name, so each name keys its own stream. */
function hashName(name: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) hash = Math.imul(hash ^ name.charCodeAt(i), 0x01000193);
  return hash >>> 0;
}

/** The variation `seed` draws: the same for the same seed, every time. */
export function variation(seed: number): Variation {
  const stream = (name: string): Rng => seededRng(hashName(name) ^ Math.imul(seed, 0x9e3779b1));
  const unit = (name: string): number => stream(name).next();
  return {
    range: (name, low, high) => low + (high - low) * unit(name),
    pick: (name, options) => options[Math.floor(unit(name) * options.length)] ?? options[0],
    sign: (name) => (unit(name) < 0.5 ? -1 : 1),
    phase: (name) => unit(name) * Math.PI * 2,
    stream,
  };
}

/**
 * A hue offset of `angle` (radians) as a matrix, rows first: a colour turned
 * about the grey axis, so its grey is kept. A shader multiplies by it.
 */
export type Matrix3Rows = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export function hueTurn(angle: number): Matrix3Rows {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle) / Math.sqrt(3);
  const along = (1 - cos) / 3;
  const same = cos + along;
  return [
    same,
    along - sin,
    along + sin,
    along + sin,
    same,
    along - sin,
    along - sin,
    along + sin,
    same,
  ];
}

/** `rgb` (linear) turned about the grey axis by `angle` (radians). */
export function turnHue(
  rgb: readonly [number, number, number],
  angle: number,
): [number, number, number] {
  const m = hueTurn(angle);
  return [
    m[0] * rgb[0] + m[1] * rgb[1] + m[2] * rgb[2],
    m[3] * rgb[0] + m[4] * rgb[1] + m[5] * rgb[2],
    m[6] * rgb[0] + m[7] * rgb[1] + m[8] * rgb[2],
  ];
}
