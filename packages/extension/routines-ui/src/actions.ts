/**
 * What the calendar page does with a gesture: each one read into the node
 * calls `@kb/routines` plans for it and made through the invoke path. A
 * repeating instance dragged somewhere asks first whether it is this one or
 * the series; a one-off is its routine, so it just moves.
 */
import { useState } from "react";
import {
  DEFAULT_ROUTINE_ZONE,
  moveEntry,
  resizeEntry,
  setEntryState,
  wallClock,
  type CalendarEntry,
  type Place,
} from "@kb/routines";
import { toast } from "@kb/ui-sdk";
import type { Spot } from "./drag";
import { elapsed, instantAfter, placeAt } from "./layout";
import type { CalendarGraph } from "./model";
import type { EditorTarget } from "./routine-editor";
import { mintId, runCalls } from "./writes";

export interface PendingMove {
  readonly entry: CalendarEntry;
  readonly to: Place;
}

/** The zone a routine made now keeps its times in: its calendar's when there is one choice. */
function newRoutineZone(model: CalendarGraph): string {
  const [only, ...others] = [...model.calendars.values()];
  return only !== undefined && others.length === 0 ? only.zone : DEFAULT_ROUTINE_ZONE;
}

export function useCalendarActions(model: CalendarGraph, zone: string) {
  const [opened, setOpened] = useState<{ key: string; element: HTMLElement } | null>(null);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [pending, setPending] = useState<PendingMove | null>(null);

  const applyMove = (entry: CalendarEntry, to: Place, scope: "one" | "series") => {
    const plan = moveEntry(entry, model.nodes, to, scope, mintId);
    if ("refused" in plan) toast(plan.refused);
    else void runCalls(plan.calls, "Could not move it");
  };
  const move = (entry: CalendarEntry, spot: Spot) => {
    if (entry.state === "done" || entry.state === "skipped") {
      toast(`It is ${entry.state}: take that back before moving it`);
      return;
    }
    // A timed instance dropped on a day cell keeps the time it shows at, on the page's clock.
    const minutes =
      entry.start === null ? null : (spot.minutes ?? wallClock(entry.start, zone).minutes);
    const to =
      minutes === null
        ? { day: spot.day, at: entry.at }
        : placeAt(spot.day, minutes, zone, entry.zone);
    if (to.day === entry.day && to.at === entry.at) return;
    if (entry.series) setPending({ entry, to });
    else applyMove(entry, to, "series");
  };
  const setState = (entry: CalendarEntry, state: "done" | "skipped" | null) =>
    void runCalls(setEntryState(entry, model.nodes, state, mintId), "Could not change it");
  const create = (day: string, minutes: { readonly from: number; readonly to: number } | null) => {
    const routineZone = newRoutineZone(model);
    const place =
      minutes === null ? { day, at: null } : placeAt(day, minutes.from, zone, routineZone);
    setEditor({
      kind: "new",
      settings: {
        starts: place.day,
        at: place.at ?? "",
        duration: minutes === null ? 30 : elapsed(day, minutes.from, minutes.to, zone),
      },
    });
  };
  return {
    opened,
    editor,
    pending,
    /** Open an instance's popover, or close it when that one is open: its chip toggles it. */
    open: (entry: CalendarEntry, element: HTMLElement) =>
      setOpened((now) => (now?.key === entry.key ? null : { key: entry.key, element })),
    closeOpened: () => setOpened(null),
    edit: (routine: string) => {
      setOpened(null);
      setEditor({ kind: "routine", id: routine });
    },
    create,
    closeEditor: () => setEditor(null),
    move,
    /** Its end moved: it lasts the time from its start to there, as time passes. */
    resize: (entry: CalendarEntry, end: { readonly day: string; readonly minutes: number }) => {
      if (entry.start === null) return;
      const ends = instantAfter(entry.start, end.day, end.minutes, zone);
      const duration = Math.round((ends - entry.start) / 60_000);
      if (duration > 0) void runCalls(resizeEntry(entry, duration), "Could not resize it");
    },
    choose: (scope: "one" | "series") => {
      if (pending !== null) applyMove(pending.entry, pending.to, scope);
      setPending(null);
    },
    cancelMove: () => setPending(null),
    setState,
    moveOne: (entry: CalendarEntry, to: Place) => {
      setOpened(null);
      applyMove(entry, to, entry.series ? "one" : "series");
    },
    toggleDone: (entry: CalendarEntry) => setState(entry, entry.state === "done" ? null : "done"),
    toggleSkip: (entry: CalendarEntry) =>
      setState(entry, entry.state === "skipped" ? null : "skipped"),
  };
}
