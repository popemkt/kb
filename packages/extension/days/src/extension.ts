/**
 * The days family's declaration and its plugin (DESIGN.md → Days). The
 * plugin is the entry on both hosts, as code's is: `ext.days.today`, and
 * the guard that keeps one node per period key, which every commit on
 * either host passes. A day is an ordinary node, and its page is every
 * node's page.
 */
import { Effect } from "effect";
import {
  ActionPoint,
  CAPTURE_TARGET_ROLE,
  CapturePlannerService,
  DATE_TARGET_ROLE,
  LANDING_ROLE,
  declarationPlugin,
  defineExtension,
  extensionNamespace,
  familyTags,
  guardAction,
  provideAction,
} from "@kb/contracts";
import { displayDefaultId, displaySettingIds, viewOptionId } from "@kb/model";
import { definePlugin, type Plugin } from "@kb/plugin";
import { dateDayReferences } from "./dated.ts";
import { DAYS_IDS } from "./ids.ts";
import { daysSeed } from "./seed.ts";
import { TODAY_ACTION } from "./today.ts";
import { captureToday } from "./capture.ts";
import { periodTagGuard } from "./period-tag.ts";
import { uniqueKeyGuard } from "./unique-key.ts";

/**
 * The day page, retired: it was `#day`'s default view, and a day opens in
 * the node page now. Its view's node goes, and with it the display setting
 * the fold derived for a tag's default view, its options, and the family's
 * value of it.
 */
const RETIRED_DAY_PAGE = (() => {
  const properties = displaySettingIds(DAYS_IDS.retiredDayView).properties;
  return [
    viewOptionId(DAYS_IDS.retiredDayView),
    properties,
    displayDefaultId(properties, "asked"),
    displayDefaultId(properties, "always"),
  ];
})();

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
        role: DATE_TARGET_ROLE.role,
        priority: 50,
        why: "A followed date opens its day's node, made if need be",
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
  retires: RETIRED_DAY_PAGE.map((from) => ({ from })),
  refCarriers: [{ refsOf: dateDayReferences }],
});

/**
 * The days family's plugin, on whichever kernel loads it: its action, its
 * guards and its declaration. The registry loads it under
 * {@link daysRegistryPlugin}, the page under its own entry (`@kb/days-ui`),
 * each adding its kernel's answers to the roles days replaces.
 */
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

/**
 * The days family's registry entry: its plugin, and its answer to the
 * registry's capture target, today's node in the store's zone, or the top
 * level when the `captures` setting says so (`captureToday`).
 */
export function daysRegistryPlugin(): Plugin {
  return definePlugin({
    name: daysExtension.name,
    tags: familyTags(daysExtension),
    apply: (ctx) =>
      Effect.all([ctx.plugin(daysPlugin()), ctx.provide(CapturePlannerService, captureToday)], {
        discard: true,
      }),
  });
}
