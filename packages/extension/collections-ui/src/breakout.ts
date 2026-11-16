/**
 * A collection view taking the page's width (DESIGN-UI.md → Frame views):
 * with the page centered, a view that wants the room breaks out of the
 * shell's column (`BREAKOUT_CLASS`, measured by `useBreakoutShift`). How far
 * it reaches is where it sits: the page's own frame spans the scroll region,
 * and a view under a row keeps its left edge on its own box, the child's
 * column, and reaches only to the region's right edge, so its parent's guide
 * line runs beside it, never through it. A view passes `widthPref` only to
 * override the device's preference.
 */
import {
  BREAKOUT_CLASS,
  type BreakoutReach,
  type FrameSubject,
  type Prefs,
  useBreakoutShift,
  usePrefs,
} from "@kb/ui-sdk";

export interface ViewBreakout {
  /** Whether the view breaks out of the shell's column. */
  readonly on: boolean;
  /** The element that breaks out, measured while it does. */
  readonly attach: (element: HTMLElement | null) => void;
  /** The element's classes while it breaks out. */
  readonly className: string | undefined;
  /** Its `data-breakout`: how far it reaches, while it breaks out. */
  readonly data: BreakoutReach | undefined;
}

export function useViewBreakout({
  wants,
  frame,
  widthPref,
  mounted,
}: {
  /** Whether this view takes the room at all. */
  readonly wants: boolean;
  /** The frame the view lays out: its depth says whether it sits under a row. */
  readonly frame: Pick<FrameSubject, "depth">;
  readonly widthPref: Prefs["width"] | undefined;
  /** Whether the element is drawn, so there is something to measure. */
  readonly mounted: boolean;
}): ViewBreakout {
  const stored = usePrefs((prefs) => prefs.width);
  const on = wants && (widthPref ?? stored) === "centered";
  const attach = useBreakoutShift(on && mounted);
  const reach: BreakoutReach = frame.depth > 0 ? "trailing" : "region";
  return {
    on,
    attach,
    // A gutter only on a side the view reaches past the column on.
    className: on ? `${BREAKOUT_CLASS} ${reach === "region" ? "px-4" : "pr-4"}` : undefined,
    data: on ? reach : undefined,
  };
}
