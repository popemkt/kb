/** Keyboard contribution contracts, shared by family declarations and page consumers. */
import { Effect } from "effect";
import { Point, type PluginContext } from "@kb/plugin";
import type { KeyboardDefinition, Keybinding, KeyContextSpec } from "@kb/keybindings";
import { CORE_POINT_DEFINITIONS } from "./point-definitions.ts";

export const KeybindingPoint = Point<Keybinding>()(
  CORE_POINT_DEFINITIONS.keybinding.name,
  CORE_POINT_DEFINITIONS.keybinding.spec,
);
export const KeyContextPoint = Point<KeyContextSpec>()(
  CORE_POINT_DEFINITIONS.keyContext.name,
  CORE_POINT_DEFINITIONS.keyContext.spec,
);

/** Contribute a shared definition from the page plugin that owns its behavior. */
export const contributeKeyboard = Effect.fn("contributeKeyboard")(function* (
  ctx: PluginContext,
  definition: KeyboardDefinition,
) {
  yield* Effect.forEach(
    definition.contexts ?? [],
    (entry) => ctx.contribute(KeyContextPoint, entry),
    { discard: true },
  );
  yield* Effect.forEach(
    definition.bindings ?? [],
    (entry) => ctx.contribute(KeybindingPoint, entry),
    { discard: true },
  );
});
