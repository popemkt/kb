/**
 * Core's page half, bound as its bundled declaration grants (DESIGN.md →
 * Provider roles): its declaration's views and context, and the defaults
 * of the roles it owns: `ui.capture-target` answers the top level,
 * `ui.landing` stays home and `ui.date-target` leads nowhere. A family that
 * replaces one (days) is elected over it. It owns the page's own key
 * context, `core.page`, with ⌘K (`page-keys`), and reads every key
 * context's keymap whenever the page kernel moves, so a binding a keymap
 * refuses is told when it arrives (`tellKeymaps`).
 */
import { Effect } from "effect";
import { bundledPlugin, declarationPlugin, familyTags } from "@kb/contracts";
import { coreExtension } from "@kb/operations";
import { definePlugin, type Plugin } from "@kb/plugin";
import {
  CaptureTargetService,
  DateTargetService,
  KeybindingPoint,
  KeyContextPoint,
  LandingService,
  leadsNowhere,
  stayHome,
  subscribeUiKernel,
  tellKeymaps,
  topLevelCapture,
} from "@kb/ui-sdk";
import { PAGE_BINDINGS, PAGE_CONTEXT } from "@/lib/page-keys";

export const coreUiPlugin: Plugin = bundledPlugin(
  coreExtension,
  definePlugin({
    name: coreExtension.name,
    tags: familyTags(coreExtension, "ui"),
    apply: (ctx) =>
      Effect.all(
        [
          ctx.plugin(declarationPlugin(coreExtension)),
          ctx.provide(CaptureTargetService, topLevelCapture),
          ctx.provide(LandingService, stayHome),
          ctx.provide(DateTargetService, leadsNowhere),
          ctx.contribute(KeyContextPoint, PAGE_CONTEXT),
          ...PAGE_BINDINGS.map((binding) => ctx.contribute(KeybindingPoint, binding)),
          Effect.acquireRelease(
            Effect.sync(() => subscribeUiKernel(tellKeymaps)),
            (unsubscribe) => Effect.sync(unsubscribe),
          ),
        ],
        { discard: true },
      ),
  }),
);
