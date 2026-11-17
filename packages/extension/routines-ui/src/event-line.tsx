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
import { useEntryStatus } from "./statuses";

const STATE_TEXT = { moved: "Moved", done: "Done", skipped: "Skipped" } as const;

/** The line's look: muted, in the label type, lit while it is hovered. */
// Its hover ground reaches past its words by its padding on the left as
// well, so the words start where the row's text column puts the line
// (DESIGN-UI.md → Outline layout). It is moved there (`-left-1.5`), not
// pulled by a margin: in the preview's fit-content box a negative margin
// takes the padding off the width the line is given, and it wraps.
const LINE_CLASS =
  "group/line relative -left-1.5 flex max-w-full cursor-pointer flex-wrap items-center gap-x-1.5 rounded-md px-1.5 py-0.5 text-label text-muted-foreground focus-within:bg-foreground/[0.04] hover:bg-foreground/[0.04] hover:text-foreground";

/**
 * One of the line's parts, which keeps whole and brings the separator before
 * it. The parts' row starts a separator to the left of the line's edge, so
 * the line's first part, and the first on every row it wraps to, shows none.
 */
const PART_CLASS =
  "inline-flex max-w-full min-w-0 items-center whitespace-nowrap before:w-4 before:shrink-0 before:text-center before:text-faint-foreground before:content-['·']";

/**
 * The instance's own parts, which the press opens the box from: how soon, the
 * calendar, when, how it repeats and its state, ending in its sync state,
 * which keeps to the last of them. Each is whole, so a line narrower than
 * them wraps after the time.
 */
function Described({
  entry,
  model,
  zone,
  lead,
}: {
  readonly entry: CalendarEntry;
  readonly model: CalendarGraph;
  readonly zone: string;
  /** How soon or how much is left, which says the day, so the line then shows only the time. */
  readonly lead: string | null;
}) {
  const calendar = model.calendars.get(entry.calendar);
  const status = useEntryStatus(entry);
  const node = model.nodes.get(entry.routine);
  const settings = node === undefined ? null : routineSettings(node).settings;
  const times = displayTimes(entry, zone);
  const repeat =
    settings === null ? null : describeRepeat(settings.rrule, settings.until, settings.starts);
  const sync = (
    <StatusDot status={status} calendarMode={calendar?.mode} className="ml-1.5 h-2 w-2 shrink-0" />
  );
  const last = entry.state !== "scheduled" ? "state" : repeat === null ? "when" : "repeat";
  // GAP [[01M7JJWQH1DFYE2SKW018N1P46]] the calendar's dot is drawn among the words, not in the line's glyph column
  return (
    <span className="block min-w-0 overflow-hidden">
      <span className="-ml-4 flex flex-wrap items-center">
        {lead === null ? null : (
          <span className={cn(PART_CLASS, "font-medium text-primary")} data-event-line-part="">
            <span data-event-line-moment="">{lead}</span>
          </span>
        )}
        {calendar === undefined ? null : (
          <span className={PART_CLASS} data-event-line-part="">
            <span
              className={cn("mr-1.5 h-2 w-2 shrink-0 rounded-full border-[1.5px]", inkOf(calendar))}
              aria-hidden
            />
            <span className="min-w-0 truncate">{calendar.name}</span>
          </span>
        )}
        <span className={PART_CLASS} data-event-line-part="">
          <span data-event-line-when="">
            {lead === null ? `${longDay(displayDay(entry, zone))}, ` : null}
            {times === null ? "all day" : `${times.start}–${times.end}`}
          </span>
          {last === "when" ? sync : null}
        </span>
        {repeat === null ? null : (
          <span className={PART_CLASS} data-event-line-part="">
            <span className="min-w-0 truncate" title={repeat} data-event-line-repeat="">
              {repeat}
            </span>
            {last === "repeat" ? sync : null}
          </span>
        )}
        {entry.state === "scheduled" ? null : (
          <span className={PART_CLASS} data-event-line-part="">
            <span className="text-foreground" data-entry-state={entry.state}>
              {STATE_TEXT[entry.state]}
            </span>
            {sync}
          </span>
        )}
      </span>
    </span>
  );
}

/**
 * A live line's choices, in their short words, over the end of its last row
 * while the line is hovered or holds focus. They lie over the line rather
 * than in it, so showing them never moves a part or the rows below: the
 * line's own ground, faded in from the left, hides what they cover.
 */
// GAP [[01M7FCAK9J8CW07B0W958HDWYR]] the overlay can take a click aimed at the
// line's text, and its fade names the page's background, not the line's surface.
function Choices({
  entry,
  actions,
  onMove,
}: {
  readonly entry: CalendarEntry;
  readonly actions: EventCardActions;
  readonly onMove: () => void;
}) {
  return (
    <span
      className="absolute right-0 bottom-0 isolate hidden h-full max-h-5 items-center gap-1 pl-4 group-focus-within/line:flex group-hover/line:flex"
      data-event-line-choices=""
    >
      <span
        aria-hidden
        className="absolute inset-0 -z-10 bg-background [mask-image:linear-gradient(to_right,transparent,var(--foreground)_1rem)]"
      >
        <span className="absolute inset-0 bg-foreground/[0.04]" />
      </span>
      {instanceChoices(entry).map((choice) => (
        <button
          key={choice.id}
          type="button"
          data-event-line-choice={choice.id}
          className="h-5 shrink-0 rounded-sm border border-border px-1.5 text-caption text-foreground hover:bg-foreground/[0.06]"
          onClick={(event) => {
            event.stopPropagation();
            if (choice.id === "move") onMove();
            else actions.setState(entry, chosenState(entry, choice.id));
          }}
        >
          {choice.short}
        </button>
      ))}
    </span>
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
  const status = useEntryStatus(entry ?? undefined);
  return (
    <div
      ref={line}
      className={LINE_CLASS}
      data-event-line={entry?.key ?? routine}
      data-event-line-kind={live ? "live" : "still"}
      // Anywhere on the line opens the box; its link and its choices keep their press.
      onClick={() => open(false)}
    >
      {/* The link keeps to the line's last row, as the sync state does inside the press. */}
      <span className="inline-flex max-w-full min-w-0 items-end gap-x-1.5">
        <span className="relative min-w-0">
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
          {!live || entry === null ? null : (
            <Choices entry={entry} actions={actions} onMove={() => open(true)} />
          )}
        </span>
        {status?.url === undefined ? null : (
          <a
            className="shrink-0 pb-0.5 text-faint-foreground hover:text-primary"
            href={status.url}
            target="_blank"
            rel="noreferrer"
            title="Open in Google Calendar"
            aria-label="Open in Google Calendar"
            onClick={(event) => event.stopPropagation()}
          >
            <ArrowSquareOutIcon size={12} />
          </a>
        )}
      </span>
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
