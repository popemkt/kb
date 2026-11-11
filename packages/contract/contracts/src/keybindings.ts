/** Keyboard contribution contracts, shared by family declarations and page consumers. */
import { Point } from "@kb/plugin";
import type { Keybinding, KeyContextSpec } from "@kb/keybindings";
import { CORE_POINT_DEFINITIONS } from "./point-definitions.ts";

export const KeybindingPoint = Point<Keybinding>()(
  CORE_POINT_DEFINITIONS.keybinding.name,
  CORE_POINT_DEFINITIONS.keybinding.spec,
);
export const KeyContextPoint = Point<KeyContextSpec>()(
  CORE_POINT_DEFINITIONS.keyContext.name,
  CORE_POINT_DEFINITIONS.keyContext.spec,
);
