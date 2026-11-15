/**
 * An event's preview under its row (DESIGN-UI.md → The routines calendar →
 * an event's preview is one line): one muted line for its next instance —
 * the calendar, the day and time, how it repeats, its state, then its sync
 * state and Google's link as icons — that floats the calendar's box when
 * pressed. Live, it acts in place too: the box's own choices show at its
 * end on hover or focus, and it leads with how soon the instance starts or
 * how much of it is left, over a thin progress line.
 */
import { useRef } from "react";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { describeRepeat, routineSettings, type CalendarEntry } from "@kb/routines";
import { longDay } from "@kb/calendar-kit";
import { cn } from "@kb/ui-sdk";
import type { EventCardActions } from "./event-card";
import { eventMoment } from "./event-moment";
import { chosenState, instanceChoices } from "./instance-choices";
import { displayDay, displayTimes } from "./layout";
import { inkOf, type CalendarGraph } from "./model";
import { StatusDot } from "./status-dot";

const STATE_TEXT = { moved: "Moved", done: "Done", skipped: "Skipped" } as const;

/** The line's look: muted, in the label type, lit while it is hovered. */
const LINE_CLASS =
  "group/line relative flex max-w-full cursor-pointer flex-wrap items-center gap-x-1.5 rounded-md px-1.5 py-0.5 text-label text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground";

/** What separates the line's parts. */
function Dot() {
  return (
    <span className="text-faint-foreground" aria-hidden>
      ·
    </span>
  );
}

/** The instance's own parts, which the press opens the box from: when, where, and how it repeats. */
function Described({
  entry,
  model,
  zone,
  lead,
}: {
  readonly entry: CalendarEntry;
  readonly model: CalendarGraph;
  readonly zone: string;
  readonly lead: string | null;
}) {
  const calendar = model.calendars.get(entry.calendar);
  const node = model.nodes.get(entry.routine);
  const settings = node === undefined ? null : routineSettings(node).settings;
  const times = displayTimes(entry, zone);
  return (
    <>
      {/* Up to the time, the line holds together; narrower than it, it wraps after the time. */}
      <span className="inline-flex items-center gap-x-1.5 whitespace-nowrap">
        {lead === null ? null : (
          <>
            <span className="font-medium text-primary" data-event-line-moment="">
              {lead}
            </span>
            <Dot />
          </>
        )}
        {calendar === undefined ? null : (
          <>
            <span
              className={cn("h-2 w-2 shrink-0 rounded-full border-[1.5px]", inkOf(calendar))}
              aria-hidden
            />
            {calendar.name}
            <Dot />
          </>
        )}
        <span data-event-line-when="">
          {longDay(displayDay(entry, zone))}
          {times === null ? ", all day" : `, ${times.start}–${times.end}`}
        </span>
      </span>
      {settings === null && entry.state === "scheduled" ? null : (
        <span className="inline-flex items-center gap-x-1.5">
          {settings === null ? null : (
            <>
              <Dot />
              <span data-event-line-repeat="">
                {describeRepeat(settings.rrule, settings.until, settings.starts)}
              </span>
            </>
          )}
          {entry.state === "scheduled" ? null : (
            <>
              <Dot />
              <span className="text-foreground" data-entry-state={entry.state}>
                {STATE_TEXT[entry.state]}
              </span>
            </>
          )}
        </span>
      )}
    </>
  );
}

export function EventLine({
  routine,
  entry,
  model,
  zone,
  now,
  live,
  actions,
  onOpen,
}: {
  readonly routine: string;
  readonly entry: CalendarEntry | null;
  readonly model: CalendarGraph;
  readonly zone: string;
  /** The page's clock, which a live line reads how soon or how much is left from. */
  readonly now: number;
  /** Whether the line is the view's controls acting in place (`ViewKey.preview`). */
  readonly live: boolean;
  readonly actions: EventCardActions;
  /** Float the box over `line`, with its move fields open when `moving`. */
  readonly onOpen: (line: HTMLElement, moving: boolean) => void;
}) {
  const line = useRef<HTMLDivElement>(null);
  const open = (moving: boolean) => {
    if (line.current !== null) onOpen(line.current, moving);
  };
  const moment = live && entry !== null ? eventMoment(entry, now) : null;
  const calendar = entry === null ? undefined : model.calendars.get(entry.calendar);
  return (
    <div
      ref={line}
      className={LINE_CLASS}
      data-event-line={entry?.key ?? routine}
      data-event-line-kind={live ? "live" : "still"}
      // Anywhere on the line opens the box; its link and its choices keep their press.
      onClick={() => open(false)}
    >
      <button
        type="button"
        aria-haspopup="dialog"
        className="flex min-w-0 flex-wrap items-center gap-x-1.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        data-event-line-open=""
      >
        {entry === null ? (
          <span data-event-no-instance="">No instance from today on</span>
        ) : (
          <Described entry={entry} model={model} zone={zone} lead={moment?.text ?? null} />
        )}
      </button>
      {entry === null ? null : (
        <StatusDot status={entry.status} calendarMode={calendar?.mode} className="h-2 w-2" />
      )}
      {entry?.status?.url === undefined ? null : (
        <a
          className="text-faint-foreground hover:text-primary"
          href={entry.status.url}
          target="_blank"
          rel="noreferrer"
          title="Open in Google Calendar"
          aria-label="Open in Google Calendar"
          onClick={(event) => event.stopPropagation()}
        >
          <ArrowSquareOutIcon size={12} />
        </a>
      )}
      {!live || entry === null ? null : (
        <span className="ml-1 hidden items-center gap-1 group-hover/line:inline-flex group-focus-within/line:inline-flex">
          {instanceChoices(entry).map((choice) => (
            <button
              key={choice.id}
              type="button"
              data-event-line-choice={choice.id}
              className="h-5 rounded-sm border border-border px-1.5 text-caption text-foreground hover:bg-background"
              onClick={(event) => {
                event.stopPropagation();
                if (choice.id === "move") open(true);
                else actions.setState(entry, chosenState(entry, choice.id));
              }}
            >
              {choice.label}
            </button>
          ))}
        </span>
      )}
      {moment?.progress === null || moment === null ? null : (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-1.5 bottom-0 h-0.5 overflow-hidden rounded-full bg-border"
          data-event-line-progress={moment.progress.toFixed(2)}
        >
          <span
            className="block h-full bg-primary"
            style={{ width: `${String(Math.round(moment.progress * 100))}%` }}
          />
        </span>
      )}
    </div>
  );
}
