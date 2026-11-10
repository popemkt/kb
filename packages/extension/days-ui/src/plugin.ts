import { lazy } from "react";
import { Effect } from "effect";
import { familyTags } from "@kb/contracts";
import { DAYS_IDS, DAYS_POINT_DEFINITIONS, DayView, daysExtension, daysPlugin } from "@kb/days";
import { refValuesOf } from "@kb/model";
import { definePlugin } from "@kb/plugin";
import {
  BrowserHostService,
  browserHost,
  CaptureTargetService,
  CommandPoint,
  DateTargetService,
  LandingService,
  provideView,
  SidebarSectionPoint,
  ViewPoint,
} from "@kb/ui-sdk";
import { goToTodayCommand } from "./command";
import { DaySectionPoint } from "./sections";
import { TodaySection } from "./section";
import { dayNode, todayNode } from "./today";

/**
 * The day page, in a chunk of its own: the page fetches it the first time a
 * day opens, so what every visit loads keeps only the family's declaration,
 * its Today row, its command and its role answers.
 */
const DayPage = lazy(() => import("./day-page").then((m) => ({ default: m.DayPage })));

/**
 * The day page's sections point, and the one days fills (DESIGN-UI.md →
 * Days): what was made or edited on the day. What is dated the day is the
 * day's References, each naming its date field. A section's body is a
 * chunk of its own, fetched with the page.
 */
const daySectionsPlugin = definePlugin({
  name: "day-sections",
  apply: (ctx) =>
    Effect.gen(function* () {
      const point = yield* ctx.declare(DaySectionPoint, DAYS_POINT_DEFINITIONS.sections.spec);
      yield* ctx.contribute(point, {
        id: "touched",
        value: {
          order: 30,
          title: "Made or edited this day",
          Component: lazy(() =>
            import("./touched-section").then((m) => ({ default: m.TouchedSection })),
          ),
        },
      });
    }),
});

/**
 * Where a page that loads at the root opens (DESIGN-UI.md → Days): today's
 * node unless the family's `open on` setting says home. The shell asks once
 * per page load, so switching the family on later never moves the page.
 */
async function landOnToday(): Promise<string | null> {
  const family = browserHost().nodes().get(DAYS_IDS.family);
  const [choice] = family === undefined ? [] : refValuesOf(family, DAYS_IDS.openOnField);
  return choice === DAYS_IDS.openOnHome ? null : todayNode();
}

/**
 * The days family's page entry (DESIGN-UI.md → Days). It loads the family's
 * plugin as a child, so the day page's key, `ext.days.today` and the
 * one-node-per-key guard are the page kernel's too, and adds the day page
 * with its sections point, the Today row, ⌘K "Go to today", and its
 * replacements of three roles: the capture target and the landing answer
 * today's node, and the date target a date's own day.
 */
export const daysUiPlugin = definePlugin({
  name: daysExtension.name,
  tags: familyTags(daysExtension, "ui"),
  inject: [BrowserHostService],
  apply: (ctx) =>
    Effect.all(
      [
        ctx.plugin(daysPlugin()),
        ctx.plugin(daySectionsPlugin),
        ctx.contribute(
          ViewPoint,
          provideView(DayView, { placements: ["page"], sample: {}, Component: DayPage }),
        ),
        ctx.contribute(SidebarSectionPoint, {
          id: "section",
          value: { order: 5, Component: TodaySection },
        }),
        ctx.contribute(CommandPoint, { id: goToTodayCommand.id, value: goToTodayCommand }),
        ctx.provide(CaptureTargetService, todayNode),
        ctx.provide(LandingService, landOnToday),
        ctx.provide(DateTargetService, dayNode),
      ],
      { discard: true },
    ),
});
