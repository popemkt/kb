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
import { SYSTEM_IDS } from "@kb/model";
import {
  CaptureTargetService,
  CommandPoint,
  DateTargetService,
  LandingService,
  go,
  leadsNowhere,
  stayHome,
  subscribeUiKernel,
  tellKeymaps,
  topLevelCapture,
  type Command,
} from "@kb/ui-sdk";

function historyCommand(id: string, delta: number): Command {
  return {
    id,
    menu: { where: "global" },
    run: ({ palette }) => {
      palette.close();
      go(delta);
    },
  };
}

const historyCommands = [
  historyCommand(SYSTEM_IDS.cmdGoBack, -1),
  historyCommand(SYSTEM_IDS.cmdGoForward, 1),
];

export const coreUiPlugin: Plugin = bundledPlugin(
  coreExtension,
  definePlugin({
    name: coreExtension.name,
    tags: familyTags(coreExtension, "ui"),
    apply: (ctx) =>
      Effect.all(
        [
          ctx.plugin(declarationPlugin(coreExtension)),
          ...historyCommands.map((command) =>
            ctx.contribute(CommandPoint, { id: command.id, value: command }),
          ),
          ctx.provide(CaptureTargetService, topLevelCapture),
          ctx.provide(LandingService, stayHome),
          ctx.provide(DateTargetService, leadsNowhere),
          Effect.acquireRelease(
            Effect.sync(() => subscribeUiKernel(tellKeymaps)),
            (unsubscribe) => Effect.sync(unsubscribe),
          ),
        ],
        { discard: true },
      ),
  }),
);
