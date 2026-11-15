import { DayNumber, MonthGrid, monthCellClass, sameMonth } from "@kb/calendar-kit";
import { cn } from "@kb/ui-sdk";
import { wallClock } from "@kb/routines";
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
        monthCellClass,
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
    <MonthGrid>
      {layout.days.map((day) => (
        <MonthCell key={day} layout={layout} day={day} anchor={anchor} openDay={openDay} />
      ))}
    </MonthGrid>
  );
}
