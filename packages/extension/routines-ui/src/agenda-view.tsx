import { ArrowArcRightIcon, CheckIcon } from "@phosphor-icons/react";
import type { CalendarEntry } from "@kb/routines";
import { cn, IconButton } from "@kb/ui-sdk";
import { longDay } from "./dates";
import { displayTimes } from "./layout";
import { inkOf } from "./model";
import { StatusDot } from "./status-dot";
import type { LayoutProps } from "./week-view";

/** What an agenda row does besides opening: tick its instance done, or skip it. */
export interface InstanceActions {
  /** Done when it is not, not done when it is. */
  readonly toggleDone: (entry: CalendarEntry) => void;
  /** Skipped when it is not, back when it is. */
  readonly toggleSkip: (entry: CalendarEntry) => void;
}

function AgendaRow({
  entry,
  layout,
  actions,
}: {
  readonly entry: CalendarEntry;
  readonly layout: LayoutProps;
  readonly actions: InstanceActions;
}) {
  const calendar = layout.model.calendars.get(entry.calendar);
  const times = displayTimes(entry, layout.zone);
  const done = entry.state === "done";
  const skipped = entry.state === "skipped";
  return (
    <li
      data-entry={entry.key}
      data-entry-state={entry.state}
      className="flex min-h-11 items-center gap-2 border-b border-border/60 px-2 py-1"
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark ${entry.title} not done` : `Mark ${entry.title} done`}
        onClick={() => actions.toggleDone(entry)}
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-foreground",
          done ? "border-success bg-success/20" : "border-border hover:border-foreground/50",
        )}
      >
        <CheckIcon size={12} weight="bold" className={done ? undefined : "invisible"} />
      </button>
      <span
        className={cn("h-8 w-1 shrink-0 rounded-full border-l-4", inkOf(calendar))}
        aria-hidden
      />
      <button
        type="button"
        className={cn(
          "flex min-w-0 flex-1 flex-col items-start text-left",
          (done || skipped) && "opacity-60",
        )}
        onClick={(event) => layout.presses.open(entry, event.currentTarget)}
      >
        <span
          className={cn(
            "max-w-full truncate text-ui text-foreground",
            (done || skipped) && "line-through",
          )}
        >
          {entry.title === "" ? "Untitled" : entry.title}
        </span>
        <span className="text-meta text-muted-foreground">
          {times === null ? "All day" : `${times.start}–${times.end}`}
          {entry.state === "moved" ? " · moved" : ""}
          {skipped ? " · skipped" : ""}
        </span>
      </button>
      <StatusDot status={entry.status} calendarMode={calendar?.mode} className="h-2 w-2" />
      <IconButton
        label={skipped ? `Bring back ${entry.title}` : `Skip ${entry.title}`}
        icon={ArrowArcRightIcon}
        size="md"
        onClick={() => actions.toggleSkip(entry)}
      />
    </li>
  );
}

/** The next two weeks day by day, the days with nothing on them left out. */
export function AgendaView({
  layout,
  actions,
}: {
  readonly layout: LayoutProps;
  readonly actions: InstanceActions;
}) {
  const days = layout.days.filter((day) => (layout.model.byDay.get(day) ?? []).length > 0);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-calendar-layout="agenda">
      {days.length === 0 ? (
        <p className="px-4 py-8 text-center text-note text-muted-foreground">
          Nothing scheduled in these two weeks.
        </p>
      ) : null}
      {days.map((day) => (
        <section
          key={day}
          aria-label={longDay(day)}
          data-calendar-day={day}
          className="mx-auto w-full max-w-3xl px-1"
        >
          <h3
            className={cn(
              "sticky top-0 z-10 bg-background px-2 pb-1 pt-3 text-label kb-label",
              day === layout.today ? "text-primary" : "text-muted-foreground",
            )}
          >
            {longDay(day)}
            {day === layout.today ? " · Today" : ""}
          </h3>
          <ul>
            {(layout.model.byDay.get(day) ?? []).map((entry) => (
              <AgendaRow key={entry.key} entry={entry} layout={layout} actions={actions} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
