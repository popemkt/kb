import {
  PICKED,
  provideCommand,
  providePaletteStep,
  CommandPoint,
  PaletteStepPoint,
  provideFieldEditor,
  KeybindingPoint,
  provideKeybinding,
  provideIngest,
  useReducedMotion,
  provideValueKind,
  ValueKindPoint,
  BACKDROP_BUDGETS,
  DockPoint,
  OverlayPoint,
  RoutePoint,
  SidebarSectionPoint,
  ViewPoint,
  provideRoute,
  provideView,
} from "@kb/ui-sdk";

import {
  meterFrames,
  BackdropPoint,
  DesignSystemPoint,
  provideBackdrop,
  provideDesignSystem,
} from "@kb/appearance-kit";

/**
 * The host's own page objects: point keys compare by identity, so an extension
 * contributes through the same keys the page reads. This value is exactly the
 * author-facing page surface; a new capability joins that surface on purpose.
 * The page surface bridge holds their names and contracts together.
 */
// GAP [[01M74PDWPASZ30SBGA95EV0X0M]] NodeSectionPoint is not offered here, so only a bundled family contributes ui.node-sections
export const PAGE_EXTENSION_SDK = {
  ViewPoint,
  provideView,
  provideFieldEditor,
  RoutePoint,
  provideRoute,
  SidebarSectionPoint,
  DockPoint,
  OverlayPoint,
  CommandPoint,
  provideCommand,
  PaletteStepPoint,
  providePaletteStep,
  PICKED,
  ValueKindPoint,
  provideValueKind,
  provideIngest,
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
