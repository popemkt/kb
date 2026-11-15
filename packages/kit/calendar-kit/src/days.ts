/**
 * A calendar's days: the range each layout shows around the day it is open
 * at, a step back or on, and how a range is titled. Pure arithmetic on local
 * days (`@kb/model`'s civil calendar); weeks start on Monday. The one
 * statement of them every calendar reads (DESIGN-UI.md → Calendar).
 */
import {
  addDays,
  addMonths,
  dayAt,
  dayNumber,
  formatDay,
  parseDay,
  weekday,
  type LocalDate,
} from "@kb/model";

export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
/** The ranges a calendar lays its days out over. */
export type CalendarSpan = "day" | "week" | "month" | "agenda";

/** How many days the agenda lists from the day it is open at. */
const AGENDA_DAYS = 14;

function date(day: string): LocalDate {
  return parseDay(day) ?? { year: 1970, month: 1, day: 1 };
}

/** The local day it is in `zone` at `now`. */
export function todayIn(zone: string, now: number): string {
  const today = dayAt(now, zone) ?? dayAt(now, "UTC");
  return today === null ? "1970-01-01" : formatDay(today);
}

/** The Monday on or before `day`. */
export function weekStartOf(day: string): string {
  const local = date(day);
  return formatDay(addDays(local, -((weekday(local) + 6) % 7)));
}

/** The days a layout shows when open at `anchor`, first to last. */
export function daysOf(mode: CalendarSpan, anchor: string): readonly string[] {
  const local = date(anchor);
  if (mode === "day") return [formatDay(local)];
  if (mode === "agenda")
    return Array.from({ length: AGENDA_DAYS }, (_, i) => formatDay(addDays(local, i)));
  if (mode === "week") {
    const start = date(weekStartOf(anchor));
    return Array.from({ length: 7 }, (_, i) => formatDay(addDays(start, i)));
  }
  const first = { ...local, day: 1 };
  const last = addDays(addMonths(first, 1), -1);
  const start = date(weekStartOf(formatDay(first)));
  const weeks = Math.ceil((dayNumber(last) - dayNumber(start) + 1) / 7);
  return Array.from({ length: weeks * 7 }, (_, i) => formatDay(addDays(start, i)));
}

/** How many days a step moves a layout that is not a month. */
const STEP_DAYS = { day: 1, week: 7, agenda: AGENDA_DAYS } as const;

/** The day a step back (-1) or on (1) opens at. */
export function stepAnchor(mode: CalendarSpan, anchor: string, direction: 1 | -1): string {
  const local = date(anchor);
  if (mode === "month") return formatDay(addMonths({ ...local, day: 1 }, direction));
  return formatDay(addDays(local, direction * STEP_DAYS[mode]));
}

/** A day as `Nov 4`. */
export function shortDay(day: string): string {
  const local = date(day);
  return `${MONTH_SHORT[local.month - 1] ?? ""} ${String(local.day)}`;
}

/** A day as `Wed, Nov 4`. */
export function longDay(day: string): string {
  return `${WEEKDAY_SHORT[(weekday(date(day)) + 6) % 7] ?? ""}, ${shortDay(day)}`;
}

/** The day of the month `day` falls on. */
export function dayOfMonth(day: string): number {
  return date(day).day;
}

/** Whether `day` falls in the month of `anchor`. */
export function sameMonth(day: string, anchor: string): boolean {
  return day.slice(0, 7) === anchor.slice(0, 7);
}

/** What the toolbar calls the range a layout shows at `anchor`. */
export function titleOf(mode: CalendarSpan, anchor: string): string {
  const local = date(anchor);
  if (mode === "month") return `${MONTH_LONG[local.month - 1] ?? ""} ${String(local.year)}`;
  if (mode === "day") return `${longDay(anchor)}, ${String(local.year)}`;
  const range = daysOf(mode, anchor);
  const first = range[0] ?? anchor;
  const last = range[range.length - 1] ?? anchor;
  const end = sameMonth(first, last) ? String(dayOfMonth(last)) : shortDay(last);
  return `${shortDay(first)} – ${end}, ${last.slice(0, 4)}`;
}
