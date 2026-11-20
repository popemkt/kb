/**
 * "Go to today", the `sys.command` node the family seeds: in ⌘K, and on
 * Mod-Shift-D, a key the page answers wherever focus is (`core.page`).
 */
import { DAYS_IDS, isDayKey } from "@kb/days";
import { addDays, formatDay, parseDay } from "@kb/model";
import { browserHost, dateTarget, navigate, type Command } from "@kb/ui-sdk";
import { nodePath } from "@kb/views";
import { openToday, pageDay } from "./today";
import { keyOf } from "./touched";

const goToTodayCommand: Command = {
  id: DAYS_IDS.todayCommand,
  menu: { where: "global" },
  run: async (ctx) => {
    ctx.palette.close();
    await openToday();
  },
};

function adjacentDay(id: string | null, delta: number): string | null {
  const key = id === null ? null : keyOf(browserHost().node(id));
  const day = parseDay(key ?? "") ?? parseDay(pageDay());
  if (day === null) return null;
  const adjacent = formatDay(addDays(day, delta));
  return isDayKey(adjacent) ? adjacent : null;
}

function dayStepCommand(id: string, delta: number): Command {
  return {
    id,
    menu: { where: "global" },
    run: async ({ outline, palette }) => {
      const adjacent = adjacentDay(outline.paneSubjectId, delta);
      if (adjacent === null) return;
      palette.close();
      const target = await dateTarget(adjacent);
      if (target !== null) navigate(nodePath(target));
    },
  };
}

export const daysCommands = [
  goToTodayCommand,
  dayStepCommand(DAYS_IDS.previousDayCommand, -1),
  dayStepCommand(DAYS_IDS.nextDayCommand, 1),
];
