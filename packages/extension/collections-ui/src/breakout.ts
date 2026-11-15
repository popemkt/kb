/**
 * A collection view taking the page's width (DESIGN-UI.md → Frame views):
 * with the page centered, a view that wants the room breaks out of the
 * shell's column to span the scroll region (`BREAKOUT_CLASS`, measured by
 * `useBreakoutShift`). A view passes `widthPref` only to override the
 * device's preference.
 */
import { BREAKOUT_CLASS, type Prefs, useBreakoutShift, usePrefs } from "@kb/ui-sdk";

export interface ViewBreakout {
  /** Whether the view spans the scroll region's width. */
  readonly on: boolean;
  /** The element that breaks out, measured while it does. */
  readonly attach: (element: HTMLElement | null) => void;
  /** The element's classes while it breaks out. */
  readonly className: string | undefined;
  /** Its `data-breakout`. */
  readonly data: "centered" | undefined;
}

export function useViewBreakout({
  wants,
  widthPref,
  mounted,
}: {
  /** Whether this view takes the room at all. */
  readonly wants: boolean;
  readonly widthPref: Prefs["width"] | undefined;
  /** Whether the element is drawn, so there is something to measure. */
  readonly mounted: boolean;
}): ViewBreakout {
  const stored = usePrefs((prefs) => prefs.width);
  const on = wants && (widthPref ?? stored) === "centered";
  const attach = useBreakoutShift(on && mounted);
  return {
    on,
    attach,
    className: on ? `${BREAKOUT_CLASS} px-4` : undefined,
    data: on ? "centered" : undefined,
  };
}
