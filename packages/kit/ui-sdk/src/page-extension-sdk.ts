import { CommandPoint } from "./lib/command-point";
import { meterFrames } from "./lib/frame-meter";
import { KeybindingPoint, provideKeybinding } from "./lib/keybindings";
import { useReducedMotion } from "./lib/motion";
import {
  BACKDROP_BUDGETS,
  BackdropPoint,
  DesignSystemPoint,
  DockPoint,
  OverlayPoint,
  RoutePoint,
  SidebarSectionPoint,
  ViewPoint,
  provideBackdrop,
  provideDesignSystem,
  provideRoute,
  provideView,
} from "./lib/plugins";

/**
 * The host's own page objects: point keys compare by identity, so an extension
 * contributes through the same keys the page reads. This value is exactly the
 * author-facing page surface; a new capability joins that surface on purpose.
 * The page surface bridge holds their names and contracts together.
 */
export const PAGE_EXTENSION_SDK = {
  ViewPoint,
  provideView,
  RoutePoint,
  provideRoute,
  SidebarSectionPoint,
  DockPoint,
  OverlayPoint,
  CommandPoint,
  KeybindingPoint,
  provideKeybinding,
  DesignSystemPoint,
  provideDesignSystem,
  BACKDROP_BUDGETS,
  BackdropPoint,
  provideBackdrop,
  meterFrames,
  useReducedMotion,
} as const;
