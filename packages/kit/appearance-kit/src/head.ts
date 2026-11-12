import type { Backdrop, BackdropInteraction } from "./lib/appearance-points";
import type { BackdropBudget } from "@kb/ui-sdk";

/**
 * A theme's head drawn as a band across the top, as tall as Broadcast's:
 * the presentation a theme's second heads share, so each family states
 * only what it draws, what drawing it may cost a frame, and what it
 * answers.
 */
export function band(
  Component: Backdrop["Component"],
  budget: BackdropBudget,
  interactions: readonly BackdropInteraction[],
): Omit<Backdrop, "key"> {
  return {
    budget,
    interactions,
    presentation: {
      space: 160,
      directions: [],
      height: 180,
      span: { reach: "content", maxWidth: 1080 },
      offset: -10,
      opacity: { subtle: 0.72, soft: 0.86, vivid: 1 },
    },
    Component,
  };
}

/*
 * A veil component plays both kinds of passing gesture: a write's, keyed on
 * the activity, and a page change's, keyed on the path. The window's veil
 * hears only the activity (its path never changes), and each pane's plane
 * only its own path (its activity never does), so a write plays once over
 * the window and a page change only in the pane whose page changed.
 */

/** The path the window's veil hands its veil: never a page change. */
export const NOWHERE = "";
