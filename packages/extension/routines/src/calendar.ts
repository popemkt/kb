/**
 * The calendar's reading of the graph: each routine's instances in a range of
 * days, as the engine projects them. A routine's series is expanded through the
 * same canonical rule and RRULE engine its projection sends, an instance takes
 * its occurrence fact by its original day, and a routine the projection refuses
 * is an issue rather than an entry, so the calendar never shows what Google
 * would not.
 */
import { DateTime, Option } from "effect";
import { firstRef, formatDay, parseDay, typeRefsOf, type NodeLike } from "@kb/model";
import { readRoutine, readSyncStatus, routineOccurrences, routineZone } from "./config.ts";
import { SyncError, type Occurrence, type Routine, type SyncStatus } from "./model.ts";
import { instancePlace, project, recurrence } from "./projection.ts";
import { RRule } from "./rrule.ts";
import { ROUTINE_FIELDS as F, ROUTINE_TAGS as T } from "./seed.ts";

/** What an instance is now: as the series has it, or as its occurrence fact says. */
export type EntryState = "scheduled" | Occurrence["state"];

/** One instance of a routine, where the calendar shows it. */
export interface CalendarEntry {
  /** The routine and the original day: the instance's identity. */
  readonly key: string;
  readonly routine: string;
  readonly title: string;
  /** The day the series puts it on, which its occurrence fact is keyed by. */
  readonly on: string;
  /** Whether the routine repeats; a one-off's one instance is the routine itself. */
  readonly series: boolean;
  /** The local day it shows on, in its routine's zone. */
  readonly day: string;
  /** Its local start time, or null when it lasts all day. */
  readonly at: string | null;
  /** Its start and end instants (epoch ms); null when it lasts all day. */
  readonly start: number | null;
  readonly end: number | null;
  readonly duration: number;
  readonly zone: string;
  readonly state: EntryState;
  /** The occurrence node that holds its fact, if it has one. */
  readonly occurrence: string | null;
  /** The calendar node the routine is on; empty when it names none. */
  readonly calendar: string;
  /** Its sync status: its occurrence's when that has one, else its routine's. */
  readonly status: SyncStatus | null;
}

/**
 * Whether an instance can be ticked done or skipped: whether it can hold an
 * `#occurrence` fact, which the engine projects only as an exception to a
 * series.
 */
// GAP [[01M6HGRGWW0WZ41V24SK89KXQY]]: a one-off routine has no done or skip.
export const takesFacts = (instance: CalendarEntry): boolean => instance.series;

/** A routine the calendar cannot show, and why. */
export interface CalendarIssue {
  readonly routine: string;
  readonly title: string;
  readonly code: string;
}

const invalid = () => new SyncError({ status: 400, code: "invalid_rule" });

function checkedDay(value: string): string {
  const parsed = parseDay(value);
  if (parsed === null) throw invalid();
  return formatDay(parsed);
}

/** A local day and time as a UTC date with the same wall clock: how RRULE reads floating time. */
function floating(day: string, time = "00:00:00"): Date {
  return DateTime.toDateUtc(DateTime.makeUnsafe(day + "T" + time + "Z"));
}

/** The UTC instant an RRULE `UNTIL=…T…Z` names, as epoch ms. */
function untilInstant(until: string): number {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(until);
  if (match === null) throw invalid();
  return DateTime.toEpochMillis(
    DateTime.makeUnsafe(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`),
  );
}

/**
 * The days in `from`…`to` (inclusive, local days) on which the routine's
 * series has an instance: its start for a one-off, else the days of the
 * recurrence its event is sent with (`recurrence`), counted from its start.
 * A date UNTIL bounds the day; a UTC one bounds each instance's start.
 */
export function seriesDays(routine: Routine, from: string, to: string): readonly string[] {
  const starts = checkedDay(routine.starts);
  const [sent] = recurrence(routine);
  if (sent === undefined) return starts >= from && starts <= to ? [starts] : [];
  const parts = sent.replace(/^RRULE:/, "").split(";");
  const until = parts.find((part) => part.startsWith("UNTIL="))?.slice("UNTIL=".length);
  const dayBound =
    until === undefined
      ? null
      : /^\d{8}$/.test(until)
        ? checkedDay(`${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6)}`)
        : null;
  const instantBound = until === undefined || dayBound !== null ? null : untilInstant(until);
  const coarse = instantBound === null ? dayBound : wallClock(instantBound, routine.zone).day;
  const last = coarse !== null && coarse < to ? coarse : to;
  const first = starts > from ? starts : from;
  if (last < first) return [];
  const rule = new RRule({
    ...RRule.parseString(parts.filter((part) => !part.startsWith("UNTIL=")).join(";")),
    dtstart: floating(starts),
  });
  return rule
    .between(floating(first), floating(last, "23:59:59"), true)
    .map((date) => DateTime.formatIsoDateUtc(DateTime.makeUnsafe(date)))
    .filter(
      (day) =>
        instantBound === null ||
        instantOf(day, routine.at ?? "00:00", routine.zone) <= instantBound,
    );
}

/** The instant a local day and time name in `zone`; a time a DST gap skips moves past the gap. */
export function instantOf(day: string, at: string, zone: string): number {
  return DateTime.toEpochMillis(
    DateTime.makeZonedUnsafe(day + "T" + at + ":00", { timeZone: zone, adjustForTimeZone: true }),
  );
}

/** Where an instant falls on the wall clock of `zone`: its local day and minutes past midnight. */
export function wallClock(
  ms: number,
  zone: string,
): { readonly day: string; readonly minutes: number } {
  const parts = DateTime.toParts(DateTime.makeZonedUnsafe(ms, { timeZone: zone }));
  return {
    day: formatDay({ year: parts.year, month: parts.month, day: parts.day }),
    minutes: parts.hour * 60 + parts.minute,
  };
}

/** `HH:MM` for minutes past midnight. */
export function clockText(minutes: number): string {
  return (
    String(Math.floor(minutes / 60)).padStart(2, "0") + ":" + String(minutes % 60).padStart(2, "0")
  );
}

/** Minutes past midnight for `HH:MM`. */
export function clockMinutes(at: string): number {
  const [hours = "0", minutes = "0"] = at.split(":");
  return Number(hours) * 60 + Number(minutes);
}

/** Whether `zone` is an IANA zone this runtime knows. */
export function knownZone(zone: string): boolean {
  return Option.isSome(DateTime.zoneMakeNamed(zone));
}

function entry(
  node: NodeLike,
  routine: Routine,
  on: string,
  occurrence: { readonly node: NodeLike; readonly occurrence: Occurrence } | undefined,
): CalendarEntry {
  const fact = occurrence?.occurrence ?? null;
  const { day, at } = instancePlace(routine, on, fact);
  const start = at === null ? null : instantOf(day, at, routine.zone);
  return {
    key: node.id + "/" + on,
    routine: node.id,
    title: routine.title,
    on,
    series: routine.rrule.trim() !== "",
    day,
    at,
    start,
    end: start === null ? null : start + routine.duration * 60_000,
    duration: routine.duration,
    zone: routine.zone,
    state: fact?.state ?? "scheduled",
    occurrence: occurrence?.node.id ?? null,
    calendar: firstRef(F.calendar)(node.props) ?? "",
    status:
      (occurrence === undefined ? null : readSyncStatus(occurrence.node)) ?? readSyncStatus(node),
  };
}

/**
 * Every routine's instances shown on a local day in `from`…`to`, in their
 * routines' zones: a series day keeps its place unless its occurrence moved it,
 * and an instance moved in from outside the range is shown where it went.
 */
export function calendarEntries(
  nodes: ReadonlyMap<string, NodeLike>,
  from: string,
  to: string,
): { readonly entries: readonly CalendarEntry[]; readonly issues: readonly CalendarIssue[] } {
  const entries: CalendarEntry[] = [];
  const issues: CalendarIssue[] = [];
  for (const node of nodes.values()) {
    if (!typeRefsOf(node).includes(T.routine)) continue;
    try {
      const { routine } = readRoutine(node, routineZone(node, nodes));
      // What the engine would refuse to send, the calendar does not show.
      project(routine, "", 0);
      const facts = routineOccurrences(node, nodes);
      const days = new Set(seriesDays(routine, from, to));
      for (const [on, fact] of facts)
        if (fact.occurrence.movedTo !== null && fact.occurrence.state !== "skipped") days.add(on);
      for (const on of days) {
        const shown = entry(node, routine, on, facts.get(on));
        if (shown.day >= from && shown.day <= to) entries.push(shown);
      }
    } catch (error) {
      issues.push({
        routine: node.id,
        title: node.text,
        code: error instanceof SyncError ? error.code : "invalid_rule",
      });
    }
  }
  entries.sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      (a.start ?? -Infinity) - (b.start ?? -Infinity) ||
      a.title.localeCompare(b.title) ||
      a.key.localeCompare(b.key),
  );
  return { entries, issues };
}
