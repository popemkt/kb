/**
 * The days family's frozen ids (DESIGN.md → Days). A period node is an
 * ordinary node; these name the tags, the identity field and the family's
 * settings. A period's own id is derived from its key ({@link periodNodeId}).
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
  /** Setting: the tag a new day gets, `#day` or a tag of the person's that extends it. */
  dayTagField: "sys.f.days.dayTag",
  /** Setting: the tag a new week gets, `#week` or a tag that extends it. */
  weekTagField: "sys.f.days.weekTag",
  /** Setting: where a page that opens at the root goes. */
  openOnField: "sys.f.days.openOn",
  openOnToday: "sys.f.days.openOn.today",
  openOnHome: "sys.f.days.openOn.home",
  /** Setting: where a node written with no chosen place lands, today (the default) or the top level. */
  capturesField: "sys.f.days.captures",
  capturesToday: "sys.f.days.captures.today",
  capturesTop: "sys.f.days.captures.top",
  /** Setting: whether a period's page lists what was made or edited in it; hidden when empty. */
  touchedField: "sys.f.days.touched",
  touchedShown: "sys.f.days.touched.shown",
  touchedHidden: "sys.f.days.touched.hidden",
  /** The day page's view key, retired: a day opens in the node page. */
  retiredDayView: "days.day",
  /** Setting: the store's time zone (IANA), which says what today is away from the page. */
  timeZoneField: "sys.f.days.timeZone",
  /** The action that returns a day's node, making it and what is missing above it. */
  todayAction: "ext.days.today",
  /** ⌘K "Go to today", a `sys.command` node the seed declares. */
  todayCommand: "sys.cmd.days.today",
  /** The commit guard that keeps one node per key. */
  uniqueKeyGuard: "ext.days.unique-key",
  /** The commit guard that keeps the day and week tag settings to tags that extend the base. */
  periodTagGuard: "ext.days.period-tag",
} as const;

/**
 * The id a period node is made with: `days.2026-11-10`, `days.2026-W46`,
 * `days.2026`, and `days.journal` for the journal root the family makes.
 * Derived from the key alone, so two clones that each make one day converge
 * on one node when their stores merge (DESIGN.md → Merge resolves by id).
 * It is where a period is made, not how it is found: the key finds it.
 */
export function periodNodeId(key: string | null): string {
  return `${DAYS_FAMILY}.${key ?? "journal"}`;
}
