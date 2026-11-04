import { cn } from "@kb/ui-sdk";
import { wallClock } from "@kb/routines";
import { sameMonth, WEEKDAY_SHORT } from "./dates";
import { DayNumber } from "./day-number";
import { EntryChip } from "./entry-chip";
import type { LayoutProps } from "./week-view";

/** How many instances a month cell lists before it says how many more. */
const CELL_ROWS = 3;

function MonthCell({
  layout,
  day,
  anchor,
  openDay,
}: {
  readonly layout: LayoutProps;
  readonly day: string;
  readonly anchor: string;
  readonly openDay: (day: string) => void;
}) {
  const { model, zone, presses, drag } = layout;
  const entries = model.byDay.get(day) ?? [];
  const target = drag?.kind === "move" && drag.to.day === day;
  return (
    <div
      data-calendar-day={day}
      className={cn(
        "flex min-h-20 min-w-0 flex-col gap-px border-b border-l border-border p-0.5",
        !sameMonth(day, anchor) && "bg-muted/40",
        target && "bg-accent/60",
      )}
      onPointerDown={presses.pressSlot}
    >
      <button
        type="button"
        className="self-start rounded-full text-label"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => openDay(day)}
        aria-label={`Open the week of ${day}`}
      >
        <DayNumber day={day} today={layout.today} muted={!sameMonth(day, anchor)} />
      </button>
      {entries.slice(0, CELL_ROWS).map((entry) => (
        <EntryChip
          key={entry.key}
          entry={entry}
          calendar={model.calendars.get(entry.calendar)}
          zone={zone}
          ghost={drag?.kind === "move" && drag.entry.key === entry.key}
          onOpen={(element) => presses.open(entry, element)}
          onPointerDown={(event) =>
            presses.pressEntry(event, entry, {
              day,
              minutes: entry.start === null ? null : wallClock(entry.start, zone).minutes,
            })
          }
        />
      ))}
      {entries.length > CELL_ROWS ? (
        <button
          type="button"
          className="self-start px-1 text-caption text-muted-foreground hover:text-foreground"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => openDay(day)}
        >
          {entries.length - CELL_ROWS} more
        </button>
      ) : null}
    </div>
  );
}

/** The weeks of a month, Monday first: each day's instances, the first few of them. */
export function MonthView({
  layout,
  anchor,
  openDay,
}: {
  readonly layout: LayoutProps;
  readonly anchor: string;
  readonly openDay: (day: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-calendar-layout="month">
      <div className="grid grid-cols-7 border-b border-border">
        {WEEKDAY_SHORT.map((name) => (
          <div key={name} className="py-1 text-center text-label text-muted-foreground">
            {name}
          </div>
        ))}
      </div>
      <div className="grid flex-1 auto-rows-fr grid-cols-7 border-r border-border">
        {layout.days.map((day) => (
          <MonthCell key={day} layout={layout} day={day} anchor={anchor} openDay={openDay} />
        ))}
      </div>
    </div>
  );
}
