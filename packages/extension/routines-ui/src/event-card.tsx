/**
 * The calendar's box for one instance: when it is and how it repeats, its
 * state and its sync state, and what can be done to it here: tick it done,
 * skip it, move just this one, edit its event, open it in Google Calendar or
 * in the outline. The calendar floats it over the instance pressed
 * (`EntryPopover`); an event opened on its own, and its row's preview, draw
 * it in place. One box, so every surface edits an event the same way,
 * through the family's actions.
 */
import { useState } from "react";
import { ArrowSquareOutIcon, XIcon } from "@phosphor-icons/react";
import { describeRepeat, routineSettings, type CalendarEntry, type Place } from "@kb/routines";
import { cn, IconButton, useOpenNode } from "@kb/ui-sdk";
import { DateField } from "./date-field";
import { longDay } from "./dates";
import { BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from "./dialog";
import { displayDay, displayTimes } from "./layout";
import { inkOf, type CalendarGraph } from "./model";
import { StatusDot } from "./status-dot";
import { syncShown } from "./sync-shown";
import { TimeField } from "./time-field";

export interface EventCardActions {
  readonly setState: (entry: CalendarEntry, state: "done" | "skipped" | null) => void;
  /** Move this one instance (a one-off: the routine) to a day and time. */
  readonly moveOne: (entry: CalendarEntry, to: Place) => void;
  readonly edit: (routine: string) => void;
}

/** The box's own look, wherever it is drawn. */
const EVENT_BOX_CLASS =
  "flex flex-col gap-2 rounded-lg border border-border bg-popover p-3 text-popover-foreground";

const STATE_TEXT = { scheduled: "", moved: "Moved", done: "Done", skipped: "Skipped" } as const;

function MoveForm({
  entry,
  today,
  onMove,
}: {
  readonly entry: CalendarEntry;
  readonly today: string;
  readonly onMove: (to: Place) => void;
}) {
  const [day, setDay] = useState(entry.day);
  const [at, setAt] = useState(entry.at ?? "");
  const [readable, setReadable] = useState(true);
  // Move waits for a time it can read, when the instance has one.
  const ready = day !== "" && (entry.at === null || (at !== "" && readable));
  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-border p-2"
      data-move-form=""
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) onMove({ day, at: entry.at === null ? null : at });
      }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <DateField label="Move to day" value={day} today={today} onChange={setDay} />
        {entry.at === null ? null : (
          <TimeField label="Move to time" value={at} onChange={setAt} onText={setReadable} />
        )}
      </div>
      {readable ? null : (
        <p className="text-meta text-destructive" role="alert">
          That isn't a time yet. Type it as 9:30, 930 or 9:30pm.
        </p>
      )}
      <button type="submit" className={cn(PRIMARY_BUTTON_CLASS, "self-end")} disabled={!ready}>
        Move
      </button>
    </form>
  );
}

/** What can be done to the one instance: tick it, skip it, or move it. */
function InstanceActions({
  entry,
  today,
  actions,
}: {
  readonly entry: CalendarEntry;
  readonly today: string;
  readonly actions: EventCardActions;
}) {
  const [moving, setMoving] = useState(false);
  const done = entry.state === "done";
  const skipped = entry.state === "skipped";
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className={done ? BUTTON_CLASS : PRIMARY_BUTTON_CLASS}
          onClick={() => actions.setState(entry, done ? null : "done")}
        >
          {done ? "Not done" : "Done"}
        </button>
        <button
          type="button"
          className={BUTTON_CLASS}
          onClick={() => actions.setState(entry, skipped ? null : "skipped")}
        >
          {skipped ? "Bring back" : "Skip"}
        </button>
        {skipped ? null : (
          <button
            type="button"
            className={BUTTON_CLASS}
            aria-expanded={moving}
            onClick={() => setMoving(!moving)}
          >
            {entry.series ? "Move this one…" : "Move…"}
          </button>
        )}
      </div>
      {moving ? (
        <MoveForm entry={entry} today={today} onMove={(to) => actions.moveOne(entry, to)} />
      ) : null}
    </>
  );
}

/** The instance the box acts on: when it is, its state and sync state, and what can be done to it. */
function InstanceDetails({
  entry,
  model,
  zone,
  today,
  actions,
}: {
  readonly entry: CalendarEntry;
  readonly model: CalendarGraph;
  readonly zone: string;
  readonly today: string;
  readonly actions: EventCardActions;
}) {
  const node = model.nodes.get(entry.routine);
  const settings = node === undefined ? null : routineSettings(node).settings;
  const times = displayTimes(entry, zone);
  const calendar = model.calendars.get(entry.calendar);
  return (
    <>
      {calendar === undefined ? null : (
        <p
          className="flex items-center gap-1.5 text-meta text-muted-foreground"
          data-entry-calendar=""
        >
          <span
            className={cn("h-2.5 w-2.5 shrink-0 rounded-sm border-2", inkOf(calendar))}
            aria-hidden
          />
          {calendar.name}
        </p>
      )}
      <p className="text-meta text-muted-foreground">
        {longDay(displayDay(entry, zone))} ·{" "}
        {times === null ? "All day" : `${times.start}–${times.end}`}
        {settings === null
          ? ""
          : ` · ${describeRepeat(settings.rrule, settings.until, settings.starts)}`}
      </p>
      {entry.state === "scheduled" ? null : (
        <p className="text-meta text-foreground" data-entry-state={entry.state}>
          {STATE_TEXT[entry.state]}
          {entry.day === entry.on ? "" : ` (from ${longDay(entry.on)})`}
        </p>
      )}
      <p className="flex items-center gap-2 text-meta text-muted-foreground">
        <StatusDot status={entry.status} calendarMode={calendar?.mode} className="h-2 w-2" />
        <span className="min-w-0 flex-1">{syncShown(entry.status, calendar?.mode).text}</span>
      </p>
      {entry.status?.url === undefined ? null : (
        <a
          className="inline-flex items-center gap-1 text-meta text-primary hover:underline"
          href={entry.status.url}
          target="_blank"
          rel="noreferrer"
        >
          Open in Google Calendar <ArrowSquareOutIcon size={12} />
        </a>
      )}
      <InstanceActions entry={entry} today={today} actions={actions} />
    </>
  );
}

/**
 * The box for the event `routine` and the instance `entry` it acts on; an
 * event with none to act on (a series that has ended, one the calendar
 * cannot show) says so, and can still be edited and opened.
 */
export function EventCard({
  routine,
  entry,
  model,
  zone,
  today,
  actions,
  onClose,
  className,
}: {
  readonly routine: string;
  readonly entry: CalendarEntry | null;
  readonly model: CalendarGraph;
  readonly zone: string;
  /** Today on the page's clock, which the move's date picker marks. */
  readonly today: string;
  readonly actions: EventCardActions;
  /** Where the box floats, how it is put away: drawn as its Close button. */
  readonly onClose?: () => void;
  readonly className?: string;
}) {
  const openNode = useOpenNode();
  const title = entry?.title ?? model.nodes.get(routine)?.text ?? "";
  return (
    <div data-event-card={entry?.key ?? routine} className={cn(EVENT_BOX_CLASS, className)}>
      <div className="flex items-start gap-2">
        <h2 className="min-w-0 flex-1 text-lead text-foreground">
          {title === "" ? "Untitled" : title}
        </h2>
        {onClose === undefined ? null : (
          <IconButton label="Close" icon={XIcon} size="md" onClick={onClose} />
        )}
      </div>
      {entry === null ? (
        <p className="text-meta text-muted-foreground" data-event-no-instance="">
          No instance from today on, or none the calendar can show.
        </p>
      ) : (
        <InstanceDetails entry={entry} model={model} zone={zone} today={today} actions={actions} />
      )}
      <div className="flex gap-3 border-t border-border pt-2 text-meta">
        <button
          type="button"
          className="text-primary hover:underline"
          onClick={() => actions.edit(routine)}
        >
          Edit event
        </button>
        <button
          type="button"
          className="text-primary hover:underline"
          onClick={() => openNode(routine)}
        >
          Open in outline
        </button>
      </div>
    </div>
  );
}
