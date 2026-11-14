/**
 * "Go to today", the `sys.command` node the family seeds: in ⌘K, and on
 * Mod-Shift-D, a key the page answers wherever focus is (`core.page`).
 */
import { DAYS_IDS } from "@kb/days";
import { provideKeybinding, type Command } from "@kb/ui-sdk";
import { openToday } from "./today";

export const goToTodayCommand: Command = {
  id: DAYS_IDS.todayCommand,
  menu: { where: "global" },
  run: async (ctx) => {
    ctx.palette.close();
    await openToday();
  },
};

/** Its key: Mod-Shift-D, on the page's own keys, running the command. */
export const goToTodayKey = provideKeybinding("today", {
  context: "core.page",
  chord: "Mod-Shift-D",
  run: { command: DAYS_IDS.todayCommand },
});
