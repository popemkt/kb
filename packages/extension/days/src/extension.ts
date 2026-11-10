/**
 * The days family's declaration and its plugin (DESIGN.md → Days). The
 * plugin is the entry on both hosts, as code's is: the day page's view
 * key, `ext.days.today`, and the guard that keeps one node per period key,
 * which every commit on either host passes.
 */
import { Effect } from "effect";
import {
  ActionPoint,
  CAPTURE_TARGET_ROLE,
  declarationPlugin,
  defineExtension,
  extensionNamespace,
  familyTags,
  guardAction,
  provideAction,
  viewDef,
} from "@kb/contracts";
import { definePlugin, type Plugin } from "@kb/plugin";
import { DAYS_IDS } from "./ids.ts";
import { daysSeed } from "./seed.ts";
import { TODAY_ACTION } from "./today.ts";
import { uniqueKeyGuard } from "./unique-key.ts";
import { DayView } from "./view.ts";

export const daysExtension = defineExtension({
  name: "days",
  label: "Days",
  manifest: {
    description: "A node for every day, made when first needed; new captures land in today.",
  },
  tags: ["days"],
  optional: { byDefault: "on" },
  roles: [CAPTURE_TARGET_ROLE],
  seed: daysSeed,
  views: [viewDef(DayView)],
  tagDefaultViews: { [DAYS_IDS.dayTag]: DayView },
});

export function daysPlugin(): Plugin {
  return definePlugin({
    name: daysExtension.name,
    tags: familyTags(daysExtension),
    namespace: extensionNamespace(daysExtension.name),
    apply: (ctx) =>
      Effect.all(
        [
          ctx.contribute(ActionPoint, provideAction(TODAY_ACTION)),
          guardAction(ctx, "every write", uniqueKeyGuard, "unique-key"),
          ctx.plugin(declarationPlugin(daysExtension)),
        ],
        { discard: true },
      ),
  });
}
