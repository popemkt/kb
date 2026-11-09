import { PICKED } from "./lib/action-call";
import { provideCommand, providePaletteStep } from "./lib/command-forms";
import { CommandPoint, PaletteStepPoint } from "./lib/command-point";
import { provideFieldEditor } from "./lib/field-editor";
import { meterFrames } from "./lib/frame-meter";
import { KeybindingPoint, provideKeybinding } from "./lib/keybindings";
import { useReducedMotion } from "./lib/motion";
import { provideValueKind, ValueKindPoint } from "./lib/value-kind";
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
