/**
 * The days family's frozen ids (DESIGN.md → Days). A period node is an
 * ordinary node; these name the tags, the identity field and the family's
 * settings, never a day.
 */
import { extensionNodeId } from "@kb/model";

export const DAYS_FAMILY = "days";

export const DAYS_IDS = {
  /** The family's own node, which its settings configure. */
  family: extensionNodeId(DAYS_FAMILY),
  dayTag: "sys.tag.day",
  weekTag: "sys.tag.week",
  yearTag: "sys.tag.year",
  /** Which period a node is: `2026-11-10`, `2026-W46`, `2026`. */
  keyField: "sys.f.days.key",
  /** Setting: the node a journal's years go under; empty until the first day is made. */
  journalField: "sys.f.days.journal",
  /** Setting: where a page that opens at the root goes. */
  openOnField: "sys.f.days.openOn",
  openOnToday: "sys.f.days.openOn.today",
  openOnHome: "sys.f.days.openOn.home",
  /** The action that returns a day's node, making it and what is missing above it. */
  todayAction: "ext.days.today",
  /** ⌘K "Go to today", a `sys.command` node the seed declares. */
  todayCommand: "sys.cmd.days.today",
  /** The commit guard that keeps one node per key. */
  uniqueKeyGuard: "ext.days.unique-key",
} as const;
