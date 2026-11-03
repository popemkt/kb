/**
 * What each calendar gesture writes: plain node calls, through the slots the
 * engine's readers decode, so a routine edited on the calendar is a routine
 * the outline and the engine read the same way. Creating a routine, moving one
 * instance or its series, resizing it, ticking or skipping an instance, and
 * saving an edit each make the fewest node calls that say it.
 */
import { canonicalJson, type NodeLike, type PropValue } from "@kb/model";
import type { CalendarEntry } from "./calendar.ts";
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

/** What a new routine is made with. */
export interface NewRoutine {
  readonly id: string;
  readonly title: string;
  readonly place: Place;
  readonly duration: number;
  readonly calendar: string;
  readonly rrule: string;
}

/** Make a routine: one node, tagged, with its settings, in one call. */
export function addRoutine(routine: NewRoutine): NodeCall {
  return {
    id: "node.add",
    input: {
      id: routine.id,
      text: routine.title,
      tags: [T.routine],
      props: propsOf(
        routineWrite({
          starts: routine.place.day,
          at: routine.place.at ?? "",
          duration: routine.duration,
          calendar: routine.calendar,
          rrule: routine.rrule,
        }),
      ),
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

/**
 * Move a whole series by where one of its instances goes: its start (and so
 * every day) by the days between, its rule turned with it, its time to the
 * new time; each fact keyed by an original day moves with its day. Null when
 * the rule cannot be moved by days without changing what it says.
 */
function moveSeries(
  entry: CalendarEntry,
  node: NodeLike,
  nodes: ReadonlyMap<string, NodeLike>,
  to: Place,
): readonly NodeCall[] | null {
  const { routine } = readRoutine(node, routineZone(node, nodes));
  const days = daysBetween(entry.day, to.day);
  const rrule = shiftRule(routine.rrule, days);
  if (rrule === null) return null;
  const calls: NodeCall[] = [
    update(
      node.id,
      routineWrite({
        starts: shiftDay(routine.starts, days),
        at: to.at ?? "",
        ...(rrule === routine.rrule ? {} : { rrule }),
      }),
    ),
  ];
  if (days !== 0)
    for (const [on, fact] of routineOccurrences(node, nodes))
      calls.push(update(fact.node.id, occurrenceWrite({ on: shiftDay(on, days) })));
  return calls;
}

/**
 * Move an instance to `to`: just this one (`one`) or every one of its series
 * (`series`). A one-off's instance is the routine, so it moves the routine.
 * Null when the series cannot be moved that way and must be edited instead.
 */
export function moveEntry(
  entry: CalendarEntry,
  nodes: ReadonlyMap<string, NodeLike>,
  to: Place,
  scope: "one" | "series",
  mint: () => string,
): readonly NodeCall[] | null {
  if (to.day === entry.day && to.at === entry.at) return [];
  const node = nodes.get(entry.routine);
  if (node === undefined) return [];
  if (!entry.series || scope === "series") return moveSeries(entry, node, nodes, to);
  const { routine } = readRoutine(node, routineZone(node, nodes));
  return moveOne(entry, routine.at, factOf(entry, nodes), to, mint);
}
