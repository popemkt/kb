/**
 * The calendar periods a day node sits in, as the keys the days family
 * stores (`sys.f.days.key`): a day is `2026-11-10`, its ISO week
 * `2026-W46`, its year `2026`. A day is a calendar date, never an instant,
 * so every function here is pure over `@kb/model`'s civil dates; the one
 * crossing from an instant is {@link dayKeyAt}, given a zone.
 */
import { addDays, dayAt, dayNumber, formatDay, parseDay, weekday, type LocalDate } from "@kb/model";

/** A calendar date, `YYYY-MM-DD`, that names a real day. */
export function isDayKey(value: string): boolean {
  return parseDay(value) !== null;
}

/** The calendar date the instant `ms` falls on in `timeZone`, or null when the zone is not one. */
export function dayKeyAt(ms: number, timeZone: string): string | null {
  const date = dayAt(ms, timeZone);
  return date === null ? null : formatDay(date);
}

function dateOf(day: string): LocalDate {
  const date = parseDay(day);
  if (date === null) throw new RangeError(`not a calendar date (YYYY-MM-DD): ${day}`);
  return date;
}

/**
 * The ISO 8601 week a day falls in. A week belongs to the year its
 * Thursday falls in, so 2026-12-31 is in 2026-W53 and 2027-01-01 is too.
 */
export function isoWeekOf(day: string): { readonly year: number; readonly week: number } {
  const date = dateOf(day);
  const mondayBased = (weekday(date) + 6) % 7;
  const thursday = addDays(date, 3 - mondayBased);
  const jan1 = { year: thursday.year, month: 1, day: 1 };
  return {
    year: thursday.year,
    week: Math.floor((dayNumber(thursday) - dayNumber(jan1)) / 7) + 1,
  };
}

/** The key of the ISO week a day falls in, `2026-W46`. */
export function weekKey(day: string): string {
  const { year, week } = isoWeekOf(day);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** The key of the year a day's ISO week belongs to, `2026`. */
export function yearKey(day: string): string {
  return String(isoWeekOf(day).year);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
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
] as const;

/** The text a new day node starts with, `Tue, Nov 10`; the person may change it. */
export function dayTitle(day: string): string {
  const date = dateOf(day);
  return `${WEEKDAYS[weekday(date)]}, ${MONTHS[date.month - 1]} ${date.day}`;
}

/** The text a new week node starts with, `Week 46`. */
export function weekTitle(day: string): string {
  return `Week ${String(isoWeekOf(day).week).padStart(2, "0")}`;
}
