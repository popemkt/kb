/**
 * One event's box (`EventCard`), floated over what was pressed — an
 * instance's chip on the calendar, an event's line under its row — and put
 * away as every popover is.
 */
import { useRef } from "react";
import type { CalendarEntry } from "@kb/routines";
import { cn, useAnchoredPosition, useDismiss } from "@kb/ui-sdk";
import { EVENT_BOX_WIDTH, EventCard, type EventCardActions } from "./event-card";
import type { CalendarGraph } from "./model";

export function EntryPopover({
  routine,
  entry,
  moving,
  element,
  model,
  zone,
  today,
  actions,
  onClose,
}: {
  readonly routine: string;
  /** The instance it acts on; none for an event with no instance to show. */
  readonly entry: CalendarEntry | null;
  /** Whether the move's fields are open when it floats. */
  readonly moving?: boolean;
  readonly element: HTMLElement;
  readonly model: CalendarGraph;
  readonly zone: string;
  /** Today on the page's clock, which the move's date picker marks. */
  readonly today: string;
  readonly actions: EventCardActions;
  readonly onClose: () => void;
}) {
  const anchor = useRef<HTMLElement | null>(element);
  const panel = useRef<HTMLDivElement>(null);
  const style = useAnchoredPosition(anchor, panel, true);
  useDismiss(true, { inside: [panel], trigger: anchor }, onClose);
  return (
    <div
      ref={panel}
      role="dialog"
      aria-label={entry?.title ?? model.nodes.get(routine)?.text ?? "Event"}
      data-testid="entry-popover"
      className={cn("fixed z-40 overflow-y-auto rounded-lg shadow-overlay", EVENT_BOX_WIDTH)}
      style={style}
    >
      <EventCard
        routine={routine}
        entry={entry}
        moving={moving}
        model={model}
        zone={zone}
        today={today}
        actions={actions}
        onClose={onClose}
      />
    </div>
  );
}
