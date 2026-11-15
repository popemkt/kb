/**
 * What can be done to one instance, wherever it is offered: tick it done or
 * take that back, skip it or bring it back, and move just this one. The box
 * draws them as its buttons and an event's live line as its small ones
 * (DESIGN-UI.md → The routines calendar), from this one list, so the two
 * never offer different things.
 */
import type { CalendarEntry } from "@kb/routines";

/** One choice: what it does, what it says, and whether it is the one to press. */
export interface InstanceChoice {
  readonly id: "done" | "skip" | "move";
  readonly label: string;
  readonly primary: boolean;
}

/** The choices `entry` offers, in the order they are drawn: a skipped instance has nothing to move. */
export function instanceChoices(entry: CalendarEntry): readonly InstanceChoice[] {
  const done = entry.state === "done";
  const skipped = entry.state === "skipped";
  return [
    { id: "done", label: done ? "Not done" : "Done", primary: !done },
    { id: "skip", label: skipped ? "Bring back" : "Skip", primary: false },
    ...(skipped
      ? []
      : [
          { id: "move", label: entry.series ? "Move this one…" : "Move…", primary: false } as const,
        ]),
  ];
}

/** The state choosing `id` (done or skip) gives `entry`: the one it names, or back to none. */
export function chosenState(entry: CalendarEntry, id: "done" | "skip"): "done" | "skipped" | null {
  const state = id === "done" ? "done" : "skipped";
  return entry.state === state ? null : state;
}
