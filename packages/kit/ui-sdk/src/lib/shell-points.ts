/**
 * The points the shell draws around every page: the sidebar's sections, the
 * docks at the workspace's right edge, and the page overlays.
 */
import type { ComponentType } from "react";
import type { Icon } from "@phosphor-icons/react";
import { CORE_POINT_DEFINITIONS } from "@kb/contracts";
import { Point } from "@kb/plugin";
import type { MatchedRoute } from "./route-point.ts";

export interface SidebarSection {
  /** Lower first. */
  readonly order: number;
  readonly Component: ComponentType<{ readonly route: MatchedRoute | null }>;
}

export const SidebarSectionPoint = Point<SidebarSection>()(
  CORE_POINT_DEFINITIONS.sidebarSection.name,
  CORE_POINT_DEFINITIONS.sidebarSection.spec,
);

/**
 * A dock: a tool window at the workspace's right edge, beside every page
 * (the agent's chat is the first). The workspace header has one toggle per
 * dock, in `order`, and at most one dock is open.
 */
export interface Dock {
  /** Lower first. */
  readonly order: number;
  /** What its toggle and its header call it. */
  readonly label: string;
  readonly icon: Icon;
  readonly Component: ComponentType<{ readonly onClose: () => void }>;
}

export const DockPoint = Point<Dock>()(
  CORE_POINT_DEFINITIONS.dock.name,
  CORE_POINT_DEFINITIONS.dock.spec,
);

/**
 * A page overlay: something a plugin mounts once for the whole page, beside
 * every pane, such as a popover host that portals to the document (the
 * outline's frame filter is the first). The shell mounts every overlay, in
 * `order`, and names none.
 */
export interface Overlay {
  /** Lower first. */
  readonly order: number;
  readonly Component: ComponentType;
}

export const OverlayPoint = Point<Overlay>()(
  CORE_POINT_DEFINITIONS.overlay.name,
  CORE_POINT_DEFINITIONS.overlay.spec,
);
