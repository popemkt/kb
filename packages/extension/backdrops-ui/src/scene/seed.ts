/**
 * A backdrop's seed and the variation drawn from it (DESIGN-UI.md →
 * Page-head backdrops → Variation). Every load of the page shows a backdrop
 * a little differently: where its subject sits, how large, its hue, where
 * its motion starts. Each way it may differ is a named draw within a range
 * its art direction allows, so every variation still reads as the picture.
 *
 * - The seed is one per load of the page: a scene mounted again (the head
 *   remounting, Settings' cards) shows the same variation as before.
 * - Reduced motion always shows the one curated still.
 * - `?backdrop-seed=<n>` in the page's address pins the seed, so a
 *   screenshot shows the same variation each time; a test passes its own.
 * - `variation(seed)` draws by name. Each name has a stream of its own, so a
 *   draw added or removed never moves another, and a name drawn twice is the
 *   same value.
 */
import { useState } from "react";
import { seededRng, type Rng } from "./rng";

/** A still is curated: reduced motion always shows the same composition. */
const STILL_SEED = 7;

/** The seed `?backdrop-seed=` pins, if the page's address carries one. */
function pinnedSeed(): number | null {
  const search = typeof location === "undefined" ? "" : location.search;
  const pinned = new URLSearchParams(search).get("backdrop-seed");
  return pinned !== null && /^\d+$/.test(pinned) ? Number(pinned) : null;
}

/** This load's seed, drawn when a backdrop first asks for it. */
let loadSeed: number | null = null;

/** The seed a backdrop's scene is made from: this load's, or under reduced motion the curated still. */
export function useBackdropSeed(reducedMotion: boolean): number {
  const [seed] = useState(() => {
    loadSeed ??= pinnedSeed() ?? Math.floor(Math.random() * 2 ** 31);
    return loadSeed;
  });
  return reducedMotion ? STILL_SEED : seed;
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
