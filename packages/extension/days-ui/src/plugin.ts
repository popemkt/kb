import { lazy } from "react";
import { Effect } from "effect";
import { familyTags } from "@kb/contracts";
import { DAYS_IDS, DayView, daysExtension, daysPlugin } from "@kb/days";
import { refValuesOf } from "@kb/model";
import { definePlugin } from "@kb/plugin";
import {
  BrowserHostService,
  browserHost,
  CaptureTargetService,
  CommandPoint,
  LandingService,
  provideView,
  SidebarSectionPoint,
  ViewPoint,
} from "@kb/ui-sdk";
import { goToTodayCommand } from "./command";
import { TodaySection } from "./section";
import { todayNode } from "./today";

/**
 * The day page, in a chunk of its own: the page fetches it the first time a
 * day opens, so what every visit loads keeps only the family's declaration,
 * its Today row, its command and its role answers.
 */
const DayPage = lazy(() => import("./day-page").then((m) => ({ default: m.DayPage })));

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
 * one-node-per-key guard are the page kernel's too, and adds the day page,
 * the Today row, ⌘K "Go to today", and its replacements of the capture
 * target and the landing: today's node.
 */
export const daysUiPlugin = definePlugin({
  name: daysExtension.name,
  tags: familyTags(daysExtension, "ui"),
  inject: [BrowserHostService],
  apply: (ctx) =>
    Effect.all(
      [
        ctx.plugin(daysPlugin()),
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
      ],
      { discard: true },
    ),
});
