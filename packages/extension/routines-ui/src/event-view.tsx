/**
 * One event on its own (`RoutinesEventView`, DESIGN-UI.md → The routines
 * calendar → an event on its own): the calendar's box (`EventCard`) for the
 * event's next instance, opened as a page; and under the event's row, where
 * its preview is, one line for that instance (`EventLine`), which floats
 * the same box when pressed. The view key's kind of preview says which line:
 * live, the view's controls acting in place. It acts through the calendar's
 * own actions, and Edit event opens the calendar's editor, so an event is
 * edited the same way wherever its box is.
 */
import { useMemo, useState } from "react";
import { nextEntry, RoutinesEventView } from "@kb/routines";
import { todayIn } from "@kb/calendar-kit";
import { useCalendarActions } from "./actions";
import { useCalendarClock, useClockNow } from "./clock";
import { EventCard } from "./event-card";
import { EventLine } from "./event-line";
import { EntryPopover } from "./entry-popover";
import { useCalendarGraph } from "./model";
import { RoutineEditor } from "./routine-editor";

/** Where the box floats from the line, and whether its move's fields open with it. */
interface Floated {
  readonly element: HTMLElement;
  readonly moving: boolean;
}

export function EventView({ id, preview }: { readonly id: string; readonly preview: boolean }) {
  const clock = useCalendarClock();
  const live = preview && RoutinesEventView.preview === "live";
  const now = useClockNow(clock, live);
  const today = todayIn(clock.zone, now);
  const graph = useCalendarGraph();
  const actions = useCalendarActions(graph, clock.zone);
  const [floated, setFloated] = useState<Floated | null>(null);
  const node = graph.nodes.get(id);
  const entry = useMemo(
    () => (node === undefined ? null : nextEntry(node, graph.nodes, today)),
    [node, graph.nodes, today],
  );
  const shown =
    node === undefined ? (
      <p className="text-meta text-muted-foreground">This event is not in the graph.</p>
    ) : preview ? (
      <EventLine
        routine={id}
        entry={entry}
        model={graph}
        zone={clock.zone}
        now={now}
        live={live}
        actions={actions}
        onOpen={(element, moving) => setFloated({ element, moving })}
      />
    ) : (
      <EventCard
        routine={id}
        entry={entry}
        model={graph}
        zone={clock.zone}
        today={today}
        actions={actions}
      />
    );
  return (
    <div className={preview ? undefined : "mx-auto w-full max-w-sm p-6"} data-event-view={id}>
      {shown}
      {floated === null || node === undefined ? null : (
        <EntryPopover
          // A move opened from the line opens the box anew, with its fields open.
          key={String(floated.moving)}
          routine={id}
          entry={entry}
          moving={floated.moving}
          element={floated.element}
          model={graph}
          zone={clock.zone}
          today={today}
          actions={actions}
          onClose={() => setFloated(null)}
        />
      )}
      {actions.editor === null ? null : (
        <RoutineEditor
          target={actions.editor}
          model={graph}
          today={today}
          onClose={actions.closeEditor}
        />
      )}
    </div>
  );
}
