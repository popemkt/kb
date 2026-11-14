/**
 * The outline's key contexts and bindings as the page kernel holds them,
 * read from a real kernel with the outline's contributed: their namespaced
 * ids and their owner are the kernel's, not restated here.
 */
import { Effect } from "effect";
import { definePlugin, makeKernel, type Contribution, type ContributionEntry } from "@kb/plugin";
import {
  outlineExtension,
  EDITING_BINDINGS,
  EDITING_CONTEXT,
  EDITING_CONTEXT_ID,
  SELECTION_BINDINGS,
  SELECTION_CONTEXT,
  SELECTION_CONTEXT_ID,
} from "@kb/outline";
import { KeybindingPoint, KeyContextPoint } from "@kb/contracts";
import { keyContextOf, type KeyContext, type Keybinding } from "@kb/keybindings";

/** The outline's context of id `id`, as a page kernel holding the outline's two reads it. */
function outlineKeyContext(id: string): KeyContext {
  const kernel = makeKernel({ host: "page" });
  Effect.runSync(
    kernel.load(
      definePlugin({
        name: outlineExtension.name,
        apply: (ctx) =>
          Effect.all(
            [EDITING_CONTEXT, SELECTION_CONTEXT].map((context) =>
              ctx.contribute(KeyContextPoint, context),
            ),
            { discard: true },
          ),
      }),
    ),
  );
  const found = kernel.contributions(KeyContextPoint).find((context) => context.id === id);
  if (found === undefined) throw new Error(`the outline contributes no key context ${id}`);
  return keyContextOf(found);
}

/** The editing row's context, read from a kernel. */
export const EDITING_KEY_CONTEXT = outlineKeyContext(EDITING_CONTEXT_ID);

/** The selection's context, read from a kernel. */
export const SELECTION_KEY_CONTEXT = outlineKeyContext(SELECTION_CONTEXT_ID);

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
