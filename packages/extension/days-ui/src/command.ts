/**
 * "Go to today", the `sys.command` node the family seeds: in ⌘K, and on
 * Mod-Shift-D, a key the page answers wherever focus is (`core.page`).
 */
import { DAYS_IDS } from "@kb/days";
import type { Command } from "@kb/ui-sdk";
import { openToday } from "./today";

export const goToTodayCommand: Command = {
  id: DAYS_IDS.todayCommand,
  menu: { where: "global" },
  run: async (ctx) => {
    ctx.palette.close();
    await openToday();
  },
};
