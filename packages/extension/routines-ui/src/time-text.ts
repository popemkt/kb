/**
 * Times of day as the editor's fields read and write them: what a person
 * types ("9", "930", "9:30", "9.30pm", "21:30") read as `HH:MM`, minutes of
 * the day, how long something lasts in words, and where a new routine starts.
 * Pure: the fields hold the text, these say what it means.
 */
import { addDays, formatDay, parseDay } from "@kb/model";

/** Minutes in a day. */
const DAY = 24 * 60;
/** How far apart the times a time field lists are. */
const TIME_STEP = 15;

const TYPED = /^(\d{1,2})(?:[:.h]?(\d{2}))?\s*(am|pm|a|p)?$/;

/** `text` as a time of day (`HH:MM`), or null when it is not one. */
export function parseTime(text: string): string | null {
  const match = TYPED.exec(text.trim().toLowerCase());
  if (match === null) return null;
  let hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  const half = match[3]?.[0];
  if (minute > 59) return null;
  if (half !== undefined) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (half === "p" ? 12 : 0);
  }
  if (hour > 23) return null;
  return clockOf(hour * 60 + minute);
}

/** `HH:MM` as minutes of the day. */
export function minutesOf(time: string): number {
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  return hour * 60 + minute;
}

/** Minutes of the day (any whole number, wrapped onto one day) as `HH:MM`. */
export function clockOf(minutes: number): string {
  const wrapped = ((minutes % DAY) + DAY) % DAY;
  const hour = Math.floor(wrapped / 60);
  return `${String(hour).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

/** How long `minutes` is, in words: "45 min", "1 h", "1 h 30 min". */
export function lengthText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)} min`;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

/**
 * How long something lasts that starts at `start` and ends at `end` (both
 * `HH:MM`): an end before the start is on the next day, and an end at the
 * start lasts nothing.
 */
export function lengthBetween(start: string, end: string): number {
  return (((minutesOf(end) - minutesOf(start)) % DAY) + DAY) % DAY;
}

/** The times a field lists, every {@link TIME_STEP} minutes from midnight. */
export const TIMES: readonly string[] = Array.from({ length: DAY / TIME_STEP }, (_, i) =>
  clockOf(i * TIME_STEP),
);

/**
 * Where a new routine starts when nothing was pointed at: today at the next
 * half hour when today is shown, else the first day shown at nine; past the
 * last half hour of today, tomorrow at nine. `days` are the days shown,
 * `now` the minutes of today it is.
 */
export function newStart(
  days: readonly string[],
  today: string,
  now: number,
  anchor: string,
): { readonly day: string; readonly from: number } {
  const nine = 9 * 60;
  if (!days.includes(today))
    return { day: days.includes(anchor) ? anchor : (days[0] ?? anchor), from: nine };
  const next = (Math.floor(now / 30) + 1) * 30;
  if (next < DAY) return { day: today, from: next };
  const local = parseDay(today);
  return { day: local === null ? today : formatDay(addDays(local, 1)), from: nine };
}
