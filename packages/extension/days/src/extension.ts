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
  LANDING_ROLE,
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
import { periodTagGuard } from "./period-tag.ts";
import { uniqueKeyGuard } from "./unique-key.ts";
import { DayView } from "./view.ts";

export const daysExtension = defineExtension({
  name: "days",
  label: "Days",
  manifest: {
    description: "A node for every day, made when first needed; new captures land in today.",
    replaces: [
      {
        role: CAPTURE_TARGET_ROLE.role,
        priority: 50,
        why: "A node made with no chosen place lands in today's node",
      },
      {
        role: LANDING_ROLE.role,
        priority: 50,
        why: "A page that loads at the root opens on today, unless its open on setting says home",
      },
    ],
    capabilities: { page: "full" },
  },
  tags: ["days"],
  optional: { byDefault: "on" },
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
          guardAction(ctx, "every write", periodTagGuard, "period-tag"),
          ctx.plugin(declarationPlugin(daysExtension)),
        ],
        { discard: true },
      ),
  });
}
