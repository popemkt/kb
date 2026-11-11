/**
 * Core's page half, bound as its bundled declaration grants (DESIGN.md →
 * Provider roles): its declaration's views and context, and the defaults
 * of the roles it owns: `ui.capture-target` answers the top level,
 * `ui.landing` stays home and `ui.date-target` leads nowhere. A family that
 * replaces one (days) is elected over it.
 */
import { Effect } from "effect";
import { bundledPlugin, declarationPlugin, familyTags } from "@kb/contracts";
import { coreExtension } from "@kb/operations";
import { definePlugin, type Plugin } from "@kb/plugin";
import {
  CaptureTargetService,
  DateTargetService,
  LandingService,
  leadsNowhere,
  stayHome,
  topLevelCapture,
} from "@kb/ui-sdk";

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
        ],
        { discard: true },
      ),
  }),
);
