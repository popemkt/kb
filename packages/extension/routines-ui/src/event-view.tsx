/**
 * One event on its own (`RoutinesEventView`, DESIGN-UI.md → The routines
 * calendar → an event on its own): the calendar's box (`EventCard`) for the
 * event's next instance, opened as a page, or live under the event's row in
 * the outline, where its preview is. It acts through the calendar's own
 * actions, and Edit event opens the calendar's editor, so an event is
 * edited the same way wherever its box is.
 */
import { useMemo } from "react";
import { nextEntry } from "@kb/routines";
import { useCalendarActions } from "./actions";
import { useCalendarClock } from "./clock";
import { todayIn } from "./dates";
import { EventCard } from "./event-card";
import { useCalendarGraph } from "./model";
import { RoutineEditor } from "./routine-editor";

export function EventView({ id, preview }: { readonly id: string; readonly preview: boolean }) {
  const clock = useCalendarClock();
  const today = todayIn(clock.zone, clock.now());
  const graph = useCalendarGraph();
  const actions = useCalendarActions(graph, clock.zone);
  const node = graph.nodes.get(id);
  const entry = useMemo(
    () => (node === undefined ? null : nextEntry(node, graph.nodes, today)),
    [node, graph.nodes, today],
  );
  return (
    <div className={preview ? "h-full" : "mx-auto w-full max-w-sm p-6"} data-event-view={id}>
      {node === undefined ? (
        <p className="text-meta text-muted-foreground">This event is not in the graph.</p>
      ) : (
        <EventCard
          routine={id}
          entry={entry}
          model={graph}
          zone={clock.zone}
          today={today}
          actions={actions}
          // Under its row the box fills the preview's frame, which draws the edge; the frame
          // starts at every family's preview height. GAP [[01M7CHAFY5WMRYR4QKXGN26TS3]]
          className={preview ? "min-h-full rounded-none border-0" : undefined}
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
