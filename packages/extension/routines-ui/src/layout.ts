/**
 * Where instances sit on the page: on which displayed day, and in the week's
 * time grid at what minute, how tall, and in which lane beside the instances
 * they overlap. Times are shown on the wall clock of the person's zone; an
 * all-day instance keeps its own day, as a floating date does.
 */
import {
  clockText,
  instantOf,
  shiftDay,
  wallClock,
  type CalendarEntry,
  type Place,
} from "@kb/routines";
import { shortDay } from "./dates";

/** How tall an hour of the week grid is, in pixels; every drag reads minutes off it. */
export const HOUR_PX = 48;
/** What a drag snaps to, in minutes. */
export const SNAP_MINUTES = 15;

/** An instant on the wall clock of `zone`, as the box says when something happened: `Nov 10, 14:43`. */
export function momentText(ms: number, zone: string): string {
  const at = wallClock(ms, zone);
  return `${shortDay(at.day)}, ${clockText(at.minutes)}`;
}

/** The day an instance shows on, in `zone`. */
export function displayDay(entry: CalendarEntry, zone: string): string {
  return entry.start === null ? entry.day : wallClock(entry.start, zone).day;
}

/** Its start and end as `HH:MM` on the wall clock of `zone`, or null when it lasts all day. */
export function displayTimes(
  entry: CalendarEntry,
  zone: string,
): { readonly start: string; readonly end: string } | null {
  if (entry.start === null || entry.end === null) return null;
  return {
    start: clockText(wallClock(entry.start, zone).minutes),
    end: clockText(wallClock(entry.end, zone).minutes),
  };
}

export interface Placed {
  readonly entry: CalendarEntry;
  /** Minutes past midnight it starts at, and how many it spans on its day. */
  readonly top: number;
  readonly height: number;
  /** Its lane among the instances it overlaps, and how many lanes they take. */
  readonly lane: number;
  readonly lanes: number;
}

/** The timed instances of `day` in the grid: an instance past midnight is cut at the day's end. */
export function placeDay(
  entries: readonly CalendarEntry[],
  day: string,
  zone: string,
): readonly Placed[] {
  const spans = entries.flatMap((entry) => {
    if (entry.start === null || entry.end === null) return [];
    const start = wallClock(entry.start, zone);
    if (start.day !== day) return [];
    const end = wallClock(entry.end, zone);
    const bottom = end.day === day ? end.minutes : 1440;
    return [{ entry, top: start.minutes, bottom: Math.max(bottom, start.minutes + SNAP_MINUTES) }];
  });
  spans.sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  const placed: Placed[] = [];
  let cluster: { top: number; bottom: number; lane: number }[] = [];
  let clusterEnd = -1;
  const close = () => {
    const lanes = Math.max(1, ...cluster.map((span) => span.lane + 1));
    for (let i = placed.length - cluster.length; i < placed.length; i++) {
      const item = placed[i];
      if (item !== undefined) placed[i] = { ...item, lanes };
    }
    cluster = [];
  };
  for (const span of spans) {
    if (span.top >= clusterEnd) close();
    const taken = new Set(cluster.filter((other) => other.bottom > span.top).map((o) => o.lane));
    let lane = 0;
    while (taken.has(lane)) lane++;
    cluster.push({ top: span.top, bottom: span.bottom, lane });
    clusterEnd = Math.max(clusterEnd, span.bottom);
    placed.push({
      entry: span.entry,
      top: span.top,
      height: span.bottom - span.top,
      lane,
      lanes: 1,
    });
  }
  close();
  return placed;
}

/** Minutes past midnight for a pointer `y` pixels below the grid's top, snapped. */
export function minutesAt(y: number): number {
  const minutes = Math.floor(((y / HOUR_PX) * 60) / SNAP_MINUTES) * SNAP_MINUTES;
  return Math.min(Math.max(minutes, 0), 1440 - SNAP_MINUTES);
}

/**
 * The instant `minutes` past midnight on displayed `day` names in `zone`
 * (24:00 is the next day's midnight): what a drop, a resize's end and a
 * dragged slot mean, so a span across a DST change is measured in time, not
 * on the clock.
 */
function instantAt(day: string, minutes: number, zone: string): number {
  const carry = Math.floor(minutes / 1440);
  return instantOf(shiftDay(day, carry), clockText(minutes - carry * 1440), zone);
}

/** How far either way a clock change can make one wall-clock time name another instant. */
const CLOCK_SHIFTS = [-120, -60, -30, 0, 30, 60, 120].map((minutes) => minutes * 60_000);

/**
 * The first instant after `start` that `minutes` on displayed `day` names in
 * `zone`. In the hour a clock repeats, the wall-clock time names two
 * instants, and an end is the one after its start; a time a clock skips
 * names none, and reads as the instant past the gap.
 */
export function instantAfter(start: number, day: string, minutes: number, zone: string): number {
  const carry = Math.floor(minutes / 1440);
  const target = { day: shiftDay(day, carry), minutes: minutes - carry * 1440 };
  const first = instantAt(day, minutes, zone);
  const named = CLOCK_SHIFTS.map((shift) => first + shift).filter((instant) => {
    const clock = wallClock(instant, zone);
    return instant > start && clock.day === target.day && clock.minutes === target.minutes;
  });
  return named.length === 0 ? first : Math.min(...named);
}

/** The minutes between two times on displayed `day`, as time passes in `zone`. */
export function elapsed(day: string, from: number, to: number, zone: string): number {
  const start = instantAt(day, from, zone);
  return Math.round((instantAfter(start, day, to, zone) - start) / 60_000);
}

/**
 * Where an instance dropped at `minutes` on displayed `day` goes, as its
 * routine stores it: the same instant, on the wall clock of its routine's zone.
 */
export function placeAt(day: string, minutes: number, zone: string, routineZone: string): Place {
  const local = wallClock(instantAt(day, minutes, zone), routineZone);
  return { day: local.day, at: clockText(local.minutes) };
}
