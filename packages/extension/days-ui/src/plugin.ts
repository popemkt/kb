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
  getPath,
  provideView,
  SidebarSectionPoint,
  ViewPoint,
} from "@kb/ui-sdk";
import { goToTodayCommand } from "./command";
import { DayPage } from "./day-page";
import { TodaySection } from "./section";
import { openToday, todayNode } from "./today";

/** Whether this page load has decided where it opens; true once, ever. */
let opened = false;

/**
 * Opening on today (DESIGN-UI.md → Days): a page that loads at the root,
 * with nothing in its URL, goes to today unless the family's `open on`
 * setting says home. Once per page load, never when the family is switched
 * on later.
 */
function openOnToday(): void {
  if (opened) return;
  opened = true;
  if (typeof window === "undefined" || getPath() !== "/" || window.location.search !== "") return;
  const family = browserHost().nodes().get(DAYS_IDS.family);
  const [choice] = family === undefined ? [] : refValuesOf(family, DAYS_IDS.openOnField);
  if (choice === DAYS_IDS.openOnHome) return;
  void openToday();
}

/**
 * The days family's page entry (DESIGN-UI.md → Days). It loads the family's
 * plugin as a child, so the day page's key, `ext.days.today` and the
 * one-node-per-key guard are the page kernel's too, and adds the day page,
 * the Today row, ⌘K "Go to today" and the capture target: today's node.
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
        Effect.sync(openOnToday),
      ],
      { discard: true },
    ),
});
