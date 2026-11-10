/**
 * ⌘K "Go to today", the `sys.command` node the family seeds. A direct key
 * waits on a global key context a family can contribute to.
 */
// GAP [[01M6Y9H6R5D9Y8TQKZJZVWX8PB]] no global key context, so "Go to today" is a command and not a key
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
