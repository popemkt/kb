/**
 * Which pane a point of the tree is drawn in. The workspace arranges panes
 * (DESIGN-UI.md → Panes and layouts); each pane's body provides its id here,
 * so a view reports its screen, follows a link or opens a node beside itself
 * for its own pane without being told which one by its host.
 */
import { createContext, useContext } from "react";

/** The pane every tab starts with, and the one a tree outside any pane belongs to. */
export const MAIN_PANE = "main";

export const PaneContext = createContext<string>(MAIN_PANE);

/** The pane the caller is drawn in. */
export function usePane(): string {
  return useContext(PaneContext);
}

/**
 * The location the caller's pane stands at (its path), or null where it
 * stands at the page's own: in the focused pane, whose location is the URL
 * the page follows, and outside any pane. The page a pane draws is drawn at
 * it (`PaneFrame`), so a view reads where its own pane stands, not where the
 * focused pane does.
 */
export const PaneLocationContext = createContext<string | null>(null);

/** The location the caller's pane stands at, or null at the page's own (`PaneLocationContext`). */
export function usePaneLocation(): string | null {
  return useContext(PaneLocationContext);
}
