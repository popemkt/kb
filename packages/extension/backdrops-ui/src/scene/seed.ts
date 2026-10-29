import { useState } from "react";

/** A still is curated: reduced motion always shows the same composition. */
const STILL_SEED = 7;

/**
 * The seed a backdrop's scene is made from (DESIGN-UI.md → Page-head
 * backdrops): its own for each mount, and under reduced motion always the
 * one curated still.
 */
export function useBackdropSeed(reducedMotion: boolean): number {
  const [seed] = useState(() => Math.floor(Math.random() * 2 ** 31));
  return reducedMotion ? STILL_SEED : seed;
}
