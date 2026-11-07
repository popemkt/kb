/**
 * The page load's seed (DESIGN-UI.md → Page-head backdrops → Variation):
 * one per load, the same for every backdrop and every frame that asks, so
 * a head remounting, or Settings' cards, draw what the head drew. The slot
 * draws a backdrop's variant from it (`BackdropFrame`, `drawVariant`), and
 * a scene its variation.
 *
 * `?backdrop-seed=<n>` in the page's address pins it, so a screenshot shows
 * the same each time.
 */
import { useState } from "react";

/** The seed `?backdrop-seed=` pins, if the page's address carries one. */
function pinnedSeed(): number | null {
  const search = typeof location === "undefined" ? "" : location.search;
  const pinned = new URLSearchParams(search).get("backdrop-seed");
  return pinned !== null && /^\d+$/.test(pinned) ? Number(pinned) : null;
}

/** This load's seed, drawn when a backdrop first asks for it. */
let loadSeed: number | null = null;

/** This load's seed, whatever the motion setting: the same for every backdrop that asks. */
export function useLoadSeed(): number {
  const [seed] = useState(() => {
    // GAP [[01M69H8012T55AXMZBJ45Q1PVC]]: no store identity to salt it with, so no sky is a store's own.
    loadSeed ??= pinnedSeed() ?? Math.floor(Math.random() * 2 ** 31);
    return loadSeed;
  });
  return seed;
}
