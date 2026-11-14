/**
 * One instance opened on the calendar: its box (`EventCard`), floated over
 * the chip that was pressed, and put away as every popover is.
 */
import { useRef } from "react";
import type { CalendarEntry } from "@kb/routines";
import { useAnchoredPosition, useDismiss } from "@kb/ui-sdk";
import { EventCard, type EventCardActions } from "./event-card";
import type { CalendarGraph } from "./model";

export function EntryPopover({
  entry,
  element,
  model,
  zone,
  today,
  actions,
  onClose,
}: {
  readonly entry: CalendarEntry;
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
      aria-label={entry.title}
      data-testid="entry-popover"
      className="fixed z-40 w-80 overflow-y-auto rounded-lg shadow-overlay"
      style={style}
    >
      <EventCard
        routine={entry.routine}
        entry={entry}
        model={model}
        zone={zone}
        today={today}
        actions={actions}
        onClose={onClose}
      />
    </div>
  );
}
