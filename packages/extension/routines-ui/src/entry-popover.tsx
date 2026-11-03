/**
 * One instance opened: when it is and how it repeats, its state and its sync
 * state, and what can be done to it here: tick it done, skip it, move just
 * this one, open its routine, open it in Google Calendar or in the outline.
 */
import { useRef, useState } from "react";
import { ArrowSquareOutIcon, XIcon } from "@phosphor-icons/react";
import {
  describeRepeat,
  routineSettings,
  takesFacts,
  type CalendarEntry,
  type Place,
} from "@kb/routines";
import { IconButton, useAnchoredPosition, useDismiss, useOpenNode } from "@kb/ui-sdk";
import { longDay } from "./dates";
import { BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from "./dialog";
import { displayDay, displayTimes } from "./layout";
import type { CalendarModel } from "./model";
import { FIELD_CLASS } from "./repeat-picker";
import { StatusDot } from "./status-dot";
import { syncShown } from "./sync-shown";

export interface EntryPopoverActions {
  readonly setState: (entry: CalendarEntry, state: "done" | "skipped" | null) => void;
  /** Move this one instance (a one-off: the routine) to a day and time. */
  readonly moveOne: (entry: CalendarEntry, to: Place) => void;
  readonly edit: (routine: string) => void;
}

const STATE_TEXT = { scheduled: "", moved: "Moved", done: "Done", skipped: "Skipped" } as const;

function MoveForm({
  entry,
  onMove,
}: {
  readonly entry: CalendarEntry;
  readonly onMove: (to: Place) => void;
}) {
  const [day, setDay] = useState(entry.day);
  const [at, setAt] = useState(entry.at ?? "");
  return (
    <form
      className="flex flex-wrap items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        onMove({ day, at: entry.at === null ? null : at });
      }}
    >
      <input
        type="date"
        aria-label="Move to day"
        className={FIELD_CLASS}
        value={day}
        onChange={(event) => setDay(event.target.value)}
      />
      {entry.at === null ? null : (
        <input
          type="time"
          aria-label="Move to time"
          step={300}
          className={FIELD_CLASS}
          value={at}
          onChange={(event) => setAt(event.target.value)}
        />
      )}
      <button type="submit" className={PRIMARY_BUTTON_CLASS}>
        Move
      </button>
    </form>
  );
}

export function EntryPopover({
  entry,
  element,
  model,
  zone,
  actions,
  onClose,
}: {
  readonly entry: CalendarEntry;
  readonly element: HTMLElement;
  readonly model: CalendarModel;
  readonly zone: string;
  readonly actions: EntryPopoverActions;
  readonly onClose: () => void;
}) {
  const anchor = useRef<HTMLElement | null>(element);
  const panel = useRef<HTMLDivElement>(null);
  const [moving, setMoving] = useState(false);
  const style = useAnchoredPosition(anchor, panel, true);
  useDismiss(true, { inside: [panel], trigger: anchor }, onClose);
  const openNode = useOpenNode();
  const node = model.nodes.get(entry.routine);
  const settings = node === undefined ? null : routineSettings(node).settings;
  const times = displayTimes(entry, zone);
  const calendar = model.calendars.get(entry.calendar);
  const done = entry.state === "done";
  const skipped = entry.state === "skipped";
  return (
    <div
      ref={panel}
      role="dialog"
      aria-label={entry.title}
      data-testid="entry-popover"
      className="fixed z-40 flex w-72 flex-col gap-2 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-overlay"
      style={style}
    >
      <div className="flex items-start gap-2">
        <h2 className="min-w-0 flex-1 text-lead text-foreground">
          {entry.title === "" ? "Untitled" : entry.title}
        </h2>
        <IconButton label="Close" icon={XIcon} size="md" onClick={onClose} />
      </div>
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
      <div className="flex flex-wrap gap-1.5">
        {takesFacts(entry) ? (
          <>
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
          </>
        ) : null}
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
      {moving ? <MoveForm entry={entry} onMove={(to) => actions.moveOne(entry, to)} /> : null}
      <div className="flex gap-3 border-t border-border pt-2 text-meta">
        <button
          type="button"
          className="text-primary hover:underline"
          onClick={() => actions.edit(entry.routine)}
        >
          Edit routine
        </button>
        <button
          type="button"
          className="text-primary hover:underline"
          onClick={() => openNode(entry.routine)}
        >
          Open in outline
        </button>
      </div>
    </div>
  );
}
