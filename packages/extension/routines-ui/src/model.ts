/**
 * What the calendar reads of the graph, once per change: the calendars a
 * routine can be on (`CalendarGraph`, which one event's card reads too), and
 * for the page the instances of every routine shown in a range, placed on
 * the days of the person's zone (`CalendarModel`).
 */
import { useMemo } from "react";
import { addDays, formatDay, nodesOfKind, parseDay, type NodeLike } from "@kb/model";
import {
  calendarEntries,
  DEFAULT_ROUTINE_ZONE,
  readCalendar,
  ROUTINE_TAGS,
  type CalendarEntry,
  type CalendarIssue,
} from "@kb/routines";
import { useNodes } from "@kb/ui-sdk";
import { displayDay } from "./layout";

/** A calendar node a routine can be on, as the page lists it. */
export interface CalendarChoice {
  readonly id: string;
  readonly name: string;
  /** Whether it sends to Google: `on`, or held in `preview` or `paused`. */
  readonly mode: string;
  /** The zone its routines' times are in, unless a routine names its own. */
  readonly zone: string;
  /** Its colour among the calendars (`CALENDAR_INKS`). */
  readonly ink: number;
}

/** One class string per calendar colour, as Tailwind reads them whole. */
const CALENDAR_INKS = [
  "border-chart-1 bg-chart-1/15",
  "border-chart-2 bg-chart-2/15",
  "border-chart-3 bg-chart-3/15",
  "border-chart-4 bg-chart-4/15",
  "border-chart-5 bg-chart-5/15",
] as const;
/** A routine on no calendar. */
const NO_CALENDAR_INK = "border-primary bg-primary/10";

export function inkOf(calendar: CalendarChoice | undefined): string {
  return calendar === undefined
    ? NO_CALENDAR_INK
    : (CALENDAR_INKS[calendar.ink % CALENDAR_INKS.length] ?? NO_CALENDAR_INK);
}

function calendarsOf(nodes: ReadonlyMap<string, NodeLike>): readonly CalendarChoice[] {
  return nodesOfKind(nodes, ROUTINE_TAGS.calendar)
    .toSorted((a, b) => a.id.localeCompare(b.id))
    .map((node, ink) => {
      let read: { mode: string; zone: string } = { mode: "invalid", zone: DEFAULT_ROUTINE_ZONE };
      try {
        read = readCalendar(node);
      } catch {
        // A calendar the engine cannot read is listed, so a routine on it can still be opened.
      }
      const name = node.text === "" ? "Untitled calendar" : node.text;
      return { id: node.id, name, mode: read.mode, zone: read.zone, ink };
    });
}

const shift = (day: string, days: number) => {
  const local = parseDay(day);
  return local === null ? day : formatDay(addDays(local, days));
};

/** The graph as the calendar reads it: its nodes, and the calendars a routine can be on. */
export interface CalendarGraph {
  readonly nodes: ReadonlyMap<string, NodeLike>;
  readonly calendars: ReadonlyMap<string, CalendarChoice>;
}

/** The calendar graph of `nodes`, read by this component: once per change. */
export function useCalendarGraph(): CalendarGraph {
  const nodes = useNodes();
  return useMemo(
    () => ({
      nodes,
      calendars: new Map(calendarsOf(nodes).map((calendar) => [calendar.id, calendar])),
    }),
    [nodes],
  );
}

/** The calendar graph, and the instances shown on the days a page displays. */
export interface CalendarModel extends CalendarGraph {
  /** The instances shown on each displayed day, in order. */
  readonly byDay: ReadonlyMap<string, readonly CalendarEntry[]>;
  readonly issues: readonly CalendarIssue[];
}

/** The calendars, and the instances shown on `days` in `zone`. */
function readCalendarModel(
  graph: CalendarGraph,
  days: readonly string[],
  zone: string,
): CalendarModel {
  const first = days[0] ?? "1970-01-01";
  const last = days[days.length - 1] ?? first;
  // A day either side: an instance's own day may differ from the day it shows on here.
  const { entries, issues } = calendarEntries(graph.nodes, shift(first, -1), shift(last, 1));
  const byDay = new Map<string, CalendarEntry[]>(days.map((day) => [day, []]));
  for (const entry of entries) byDay.get(displayDay(entry, zone))?.push(entry);
  for (const list of byDay.values())
    list.sort((a, b) => (a.start ?? -Infinity) - (b.start ?? -Infinity));
  return { ...graph, byDay, issues };
}

export function useCalendarModel(days: readonly string[], zone: string): CalendarModel {
  const graph = useCalendarGraph();
  return useMemo(() => readCalendarModel(graph, days, zone), [graph, days, zone]);
}
