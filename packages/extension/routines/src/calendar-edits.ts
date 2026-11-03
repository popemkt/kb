/**
 * What each calendar gesture writes: plain node calls, through the slots the
 * engine's readers decode, so a routine edited on the calendar is a routine
 * the outline and the engine read the same way. Creating a routine, moving one
 * instance or its series, resizing it, ticking or skipping an instance, and
 * saving an edit each make the fewest node calls that say it.
 */
import { canonicalJson, parseDay, type NodeLike, type PropValue } from "@kb/model";
import { clockMinutes, clockText, type CalendarEntry } from "./calendar.ts";
import {
  occurrenceWrite,
  readRoutine,
  routineOccurrences,
  routineWrite,
  routineZone,
  type OccurrenceSettings,
  type RoutineSettings,
} from "./config.ts";
import type { Occurrence } from "./model.ts";
import { daysBetween, shiftDay, shiftRule } from "./repeat.ts";
import { ROUTINE_TAGS as T } from "./seed.ts";

/** One call of the page's invoke path that writes a node. */
export interface NodeCall {
  readonly id: "node.add" | "node.update" | "node.delete";
  readonly input: Readonly<Record<string, unknown>>;
}

/** Where an instance goes: a local day, and a local time or none (all day). */
export interface Place {
  readonly day: string;
  readonly at: string | null;
}

type Written = Readonly<Record<string, readonly PropValue[]>>;

const propsOf = (written: Written) =>
  Object.entries(written).flatMap(([field, values]) => values.map((value) => ({ field, value })));

function update(id: string, written: Written, text?: string): NodeCall {
  return {
    id: "node.update",
    input: {
      id,
      ...(text === undefined ? {} : { text }),
      unsetProps: Object.keys(written).map((field) => ({ field })),
      setProps: propsOf(written),
    },
  };
}

/** What a new routine is made with: its id, its title and the settings it starts with. */
export interface NewRoutine {
  readonly id: string;
  readonly title: string;
  readonly settings: Partial<RoutineSettings>;
}

/** Make a routine: one node, tagged, with its settings, in one call. */
export function addRoutine(routine: NewRoutine): NodeCall {
  return {
    id: "node.add",
    input: {
      id: routine.id,
      text: routine.title,
      tags: [T.routine],
      props: propsOf(routineWrite(routine.settings)),
    },
  };
}

/** Save an edit: the fields whose settings changed, and the title when it did. */
export function editRoutine(
  id: string,
  before: { readonly title: string; readonly settings: RoutineSettings },
  after: { readonly title: string; readonly settings: RoutineSettings },
): readonly NodeCall[] {
  const was = routineWrite(before.settings);
  const changed = Object.fromEntries(
    Object.entries(routineWrite(after.settings)).filter(
      ([field, values]) => canonicalJson(values) !== canonicalJson(was[field] ?? []),
    ),
  );
  const text = after.title === before.title ? undefined : after.title;
  if (Object.keys(changed).length === 0 && text === undefined) return [];
  return [update(id, changed, text)];
}

/** Delete a node: a routine with its occurrence facts, or one fact. */
export function deleteNode(id: string): NodeCall {
  return { id: "node.delete", input: { id } };
}

function addOccurrence(
  id: string,
  routine: string,
  settings: Partial<OccurrenceSettings>,
): NodeCall {
  return {
    id: "node.add",
    input: {
      id,
      parent: routine,
      text: settings.on ?? "",
      tags: [T.occurrence],
      props: propsOf(occurrenceWrite(settings)),
    },
  };
}

function factOf(entry: CalendarEntry, nodes: ReadonlyMap<string, NodeLike>): Occurrence | null {
  const node = nodes.get(entry.routine);
  if (node === undefined) return null;
  return routineOccurrences(node, nodes).get(entry.on)?.occurrence ?? null;
}

/**
 * Tick an instance done or skip it (`state`), or take that back (null): the
 * fact keyed by its original day is made, changed or removed. A done or
 * skipped instance that had been moved keeps its move, and taking the state
 * back leaves it moved.
 */
export function setEntryState(
  entry: CalendarEntry,
  nodes: ReadonlyMap<string, NodeLike>,
  state: "done" | "skipped" | null,
  mint: () => string,
): readonly NodeCall[] {
  const fact = factOf(entry, nodes);
  if (fact === null)
    return state === null ? [] : [addOccurrence(mint(), entry.routine, { on: entry.on, state })];
  if (state !== null) return [update(fact.id, occurrenceWrite({ state }))];
  if (fact.movedTo === null) return [deleteNode(fact.id)];
  return [update(fact.id, occurrenceWrite({ state: "moved" }))];
}

/** Change how long a routine's instances last, in minutes. */
export function resizeEntry(entry: CalendarEntry, duration: number): readonly NodeCall[] {
  return duration === entry.duration ? [] : [update(entry.routine, routineWrite({ duration }))];
}

/**
 * Move one instance of a series to `to`: its fact records the move, keyed by
 * its original day, and a move back to where the series puts it removes the
 * move. A time equal to the routine's is left to follow the routine.
 */
function moveOne(
  entry: CalendarEntry,
  routineAt: string | null,
  fact: Occurrence | null,
  to: Place,
  mint: () => string,
): readonly NodeCall[] {
  const home = to.day === entry.on && to.at === routineAt;
  const at = to.at === null || to.at === routineAt ? "" : to.at;
  if (fact === null)
    return home
      ? []
      : [
          addOccurrence(mint(), entry.routine, {
            on: entry.on,
            state: "moved",
            movedTo: to.day,
            at,
          }),
        ];
  if (home)
    return fact.state === "moved"
      ? [deleteNode(fact.id)]
      : [update(fact.id, occurrenceWrite({ movedTo: "", at: "" }))];
  return [update(fact.id, occurrenceWrite({ movedTo: to.day, at }))];
}

/** `place` moved by `minutes`: a timed one on the clock, carrying days; an all-day one by whole days. */
function displaced(place: Place, minutes: number): Place {
  if (place.at === null) return { day: shiftDay(place.day, Math.floor(minutes / 1440)), at: null };
  const total = clockMinutes(place.at) + minutes;
  return {
    day: shiftDay(place.day, Math.floor(total / 1440)),
    at: clockText(((total % 1440) + 1440) % 1440),
  };
}

/** Why a move is refused when the rule cannot carry it. */
const CANNOT_SHIFT = "This repeat cannot move by days: change it in the routine instead";

/**
 * Move a whole series by as much as one of its instances moves: its start
 * and time by that much (so every day), its rule turned with it, each fact's
 * original day by the days the series moved, and each moved instance's place
 * by the same amount, so the instance dragged lands where it was dropped.
 */
function moveSeries(
  entry: CalendarEntry,
  node: NodeLike,
  nodes: ReadonlyMap<string, NodeLike>,
  to: Place,
): MovePlan {
  const { routine } = readRoutine(node, routineZone(node, nodes));
  const minutes =
    daysBetween(entry.day, to.day) * 1440 +
    (entry.at === null || to.at === null ? 0 : clockMinutes(to.at) - clockMinutes(entry.at));
  const series = displaced({ day: routine.starts, at: routine.at }, minutes);
  const days = daysBetween(routine.starts, series.day);
  const rrule = shiftRule(routine.rrule, routine.starts, days);
  if (rrule === null) return { refused: CANNOT_SHIFT };
  const calls: NodeCall[] = [
    update(
      node.id,
      routineWrite({
        starts: series.day,
        at: series.at ?? "",
        ...(rrule === routine.rrule ? {} : { rrule }),
      }),
    ),
  ];
  for (const [on, fact] of routineOccurrences(node, nodes)) {
    const { movedTo, at } = fact.occurrence;
    const place =
      movedTo === null ? null : displaced({ day: movedTo, at: at ?? routine.at }, minutes);
    const write: Partial<OccurrenceSettings> = {
      ...(days === 0 ? {} : { on: shiftDay(on, days) }),
      ...(place === null
        ? {}
        : {
            movedTo: place.day,
            at: at === null || place.at === series.at ? "" : (place.at ?? ""),
          }),
    };
    if (Object.keys(write).length > 0) calls.push(update(fact.node.id, occurrenceWrite(write)));
  }
  return { calls };
}

/** What a move writes, or why it is refused. */
export type MovePlan = { readonly calls: readonly NodeCall[] } | { readonly refused: string };

/**
 * Move an instance to `to`: just this one (`one`) or every one of its series
 * (`series`). A one-off's instance is the routine, so it moves the routine.
 * Refused when `to` is not a day and time, or the series cannot move that way
 * and must be edited instead.
 */
export function moveEntry(
  entry: CalendarEntry,
  nodes: ReadonlyMap<string, NodeLike>,
  to: Place,
  scope: "one" | "series",
  mint: () => string,
): MovePlan {
  if (parseDay(to.day) === null || (to.at !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(to.at)))
    return { refused: "Choose a day and a time to move it to" };
  if (to.day === entry.day && to.at === entry.at) return { calls: [] };
  const node = nodes.get(entry.routine);
  if (node === undefined) return { calls: [] };
  if (!entry.series || scope === "series") return moveSeries(entry, node, nodes, to);
  const { routine } = readRoutine(node, routineZone(node, nodes));
  return { calls: moveOne(entry, routine.at, factOf(entry, nodes), to, mint) };
}
