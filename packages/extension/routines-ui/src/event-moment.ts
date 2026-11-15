/**
 * Where an instance stands against the clock, as an event's live line says
 * it (DESIGN-UI.md → The routines calendar → an event's preview is one
 * line): how soon it starts, within a day, or how much of it is left, with
 * how far through it is. Pure: the line holds the clock, this says what it
 * reads.
 */
import type { CalendarEntry } from "@kb/routines";
import { lengthText } from "./time-text";

/** How far ahead a start is said as how soon: within a day (in milliseconds). */
const SOON_MS = 86_400_000;
const MINUTE_MS = 60 * 1000;

/** What the line leads with, and how far through the instance is (0–1) while it runs. */
export interface EventMoment {
  readonly text: string;
  readonly progress: number | null;
}

/** Whole minutes from `from` to `to`, at least one, so a start a few seconds off still reads "in 1 min". */
function minutesUntil(from: number, to: number): number {
  return Math.max(1, Math.ceil((to - from) / MINUTE_MS));
}

/**
 * `entry` at `now`: "in 20 min" before a start within a day, "now · 12 min
 * left" while it runs, and nothing for an instance that lasts all day, has
 * ended, starts later than a day off, or is done or skipped.
 */
export function eventMoment(entry: CalendarEntry, now: number): EventMoment | null {
  if (entry.start === null || entry.end === null) return null;
  if (entry.state === "done" || entry.state === "skipped") return null;
  if (now < entry.start) {
    return entry.start - now > SOON_MS
      ? null
      : { text: `in ${lengthText(minutesUntil(now, entry.start))}`, progress: null };
  }
  if (now >= entry.end) return null;
  return {
    text: `now · ${lengthText(minutesUntil(now, entry.end))} left`,
    progress: (now - entry.start) / (entry.end - entry.start),
  };
}

/** How long from `now` until the next whole minute: when what the line says next changes. */
export function untilNextMinute(now: number): number {
  return MINUTE_MS - (now % MINUTE_MS);
}
