/**
 * The outline's bindings as the page kernel holds them, read from a real
 * kernel with the outline's keys contributed: their namespaced ids and
 * their owner are the kernel's, not restated here.
 */
import { Effect } from "effect";
import { definePlugin, makeKernel, type Contribution, type ContributionEntry } from "@kb/plugin";
import { outlineExtension } from "@kb/outline";
import { KeybindingPoint, type Keybinding } from "@kb/ui-sdk";
import { EDITING_BINDINGS } from "../editing-keymap";
import { SELECTION_BINDINGS } from "../selection-keymap";

/** Every binding in a page kernel holding the outline's keys, then each of `others` in order. */
export function outlineKeybindings(
  ...others: readonly {
    readonly name: string;
    readonly bindings: readonly ContributionEntry<Keybinding>[];
  }[]
): readonly Contribution<Keybinding>[] {
  const kernel = makeKernel({ host: "page" });
  const plugins = [
    { name: outlineExtension.name, bindings: [...EDITING_BINDINGS, ...SELECTION_BINDINGS] },
    ...others,
  ];
  for (const { name, bindings } of plugins) {
    Effect.runSync(
      kernel.load(
        definePlugin({
          name,
          apply: (ctx) =>
            Effect.all(
              bindings.map((binding) => ctx.contribute(KeybindingPoint, binding)),
              { discard: true },
            ),
        }),
      ),
    );
  }
  return kernel.contributions(KeybindingPoint);
}
