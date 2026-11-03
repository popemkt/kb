import { useLayoutEffect, useRef, type PointerEvent } from "react";
import { wallClock, type CalendarEntry } from "@kb/routines";
import { WEEKDAY_SHORT } from "./dates";
import { DayNumber } from "./day-number";
import type { Drag, Spot } from "./drag";
import { EntryChip } from "./entry-chip";
import { HOUR_PX, placeDay, type Placed } from "./layout";
import type { CalendarModel } from "./model";

/** What a layout hands its instances and slots: the presses that start a gesture, and opening. */
interface LayoutPresses {
  readonly pressEntry: (
    event: PointerEvent<HTMLElement>,
    entry: CalendarEntry,
    start: Spot,
  ) => void;
  readonly pressEdge: (
    event: PointerEvent<HTMLElement>,
    entry: CalendarEntry,
    top: number,
    height: number,
  ) => void;
  readonly pressSlot: (event: PointerEvent<HTMLElement>) => void;
  readonly open: (entry: CalendarEntry, element: HTMLElement) => void;
}

export interface LayoutProps {
  readonly days: readonly string[];
  readonly model: CalendarModel;
  readonly zone: string;
  readonly today: string;
  readonly now: number;
  readonly drag: Drag | null;
  readonly presses: LayoutPresses;
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const px = (minutes: number) => (minutes / 60) * HOUR_PX;
/** A day's minutes: the grid's height. */
const DAY_MINUTES = 1440;
/** The fewest minutes an instance is drawn as, so its one line stays readable. */
const MIN_DRAWN = 25;
/** Below this many minutes an instance is drawn on one line, its time before its title. */
const ONE_LINE = 45;
/** The hour the grid opens at: seven, or the hour of the earliest instance shown when it is earlier. */
const OPEN_HOUR = 7;

function openHour({ days, model, zone }: LayoutProps): number {
  const starts = days
    .flatMap((day) => model.byDay.get(day) ?? [])
    .flatMap((entry) => (entry.start === null ? [] : [wallClock(entry.start, zone).minutes]));
  return Math.min(OPEN_HOUR, Math.floor(Math.min(...starts, OPEN_HOUR * 60) / 60));
}

function TimedEntry({
  placed,
  layout,
  day,
}: {
  readonly placed: Placed;
  readonly layout: LayoutProps;
  readonly day: string;
}) {
  const { entry, top, lane, lanes } = placed;
  const { drag, presses, model, zone } = layout;
  const resizing = drag?.kind === "resize" && drag.entry.key === entry.key ? drag : null;
  const height = resizing === null ? placed.height : resizing.bottom - resizing.top;
  const dragged = drag?.kind === "move" && drag.entry.key === entry.key;
  const draggable = entry.state === "scheduled" || entry.state === "moved";
  return (
    <div
      className="absolute px-px"
      style={{
        top: px(top),
        height: px(Math.max(height, MIN_DRAWN)),
        left: `${String((lane / lanes) * 100)}%`,
        width: `${String(100 / lanes)}%`,
      }}
    >
      <EntryChip
        entry={entry}
        calendar={model.calendars.get(entry.calendar)}
        zone={zone}
        block={height >= ONE_LINE}
        ghost={dragged}
        style={{ height: "100%" }}
        onOpen={(element) => presses.open(entry, element)}
        onPointerDown={(event) => presses.pressEntry(event, entry, { day, minutes: top })}
      />
      {draggable ? (
        <div
          aria-hidden
          data-resize={entry.key}
          className="absolute inset-x-1 bottom-0 h-1.5 cursor-ns-resize touch-none"
          onPointerDown={(event) => presses.pressEdge(event, entry, top, placed.height)}
        />
      ) : null}
    </div>
  );
}

function Ghost({ layout, day }: { readonly layout: LayoutProps; readonly day: string }) {
  const { drag, model, zone } = layout;
  if (drag === null) return null;
  if (drag.kind === "create")
    return drag.day === day ? (
      <div
        data-calendar-ghost="create"
        className="pointer-events-none absolute inset-x-1 rounded-sm border border-primary bg-primary/15"
        style={{
          top: px(Math.min(drag.from, drag.to)),
          height: px(Math.abs(drag.to - drag.from) + 15),
        }}
      />
    ) : null;
  if (drag.kind !== "move" || drag.to.day !== day || drag.to.minutes === null) return null;
  return (
    <div
      data-calendar-ghost="move"
      className="pointer-events-none absolute inset-x-1"
      style={{ top: px(drag.to.minutes), height: px(Math.max(drag.entry.duration, MIN_DRAWN)) }}
    >
      <EntryChip
        entry={drag.entry}
        calendar={model.calendars.get(drag.entry.calendar)}
        zone={zone}
        block={drag.entry.duration >= ONE_LINE}
        style={{ height: "100%" }}
        onOpen={() => undefined}
      />
    </div>
  );
}

function DayColumn({ layout, day }: { readonly layout: LayoutProps; readonly day: string }) {
  const entries = layout.model.byDay.get(day) ?? [];
  const now = wallClock(layout.now, layout.zone);
  return (
    <div
      data-calendar-day={day}
      data-calendar-timed=""
      className="relative border-l border-border"
      style={{ height: px(DAY_MINUTES) }}
      onPointerDown={layout.presses.pressSlot}
    >
      {HOURS.map((hour) => (
        <div
          key={hour}
          className="pointer-events-none absolute inset-x-0 border-t border-border/60"
          style={{ top: px(hour * 60) }}
        />
      ))}
      {placeDay(entries, day, layout.zone).map((placed) => (
        <TimedEntry key={placed.entry.key} placed={placed} layout={layout} day={day} />
      ))}
      <Ghost layout={layout} day={day} />
      {now.day === day ? (
        <div
          aria-hidden
          data-calendar-now=""
          className="pointer-events-none absolute inset-x-0 h-px bg-destructive"
          style={{ top: px(now.minutes) }}
        />
      ) : null}
    </div>
  );
}

function AllDayRow({ layout }: { readonly layout: LayoutProps }) {
  const { days, model, zone, presses } = layout;
  return (
    <div className="grid grid-cols-[3rem_repeat(7,minmax(0,1fr))] border-b border-border">
      <div className="px-1 py-1 text-caption text-faint-foreground">all day</div>
      {days.map((day) => (
        <div
          key={day}
          data-calendar-day={day}
          className="flex min-h-6 flex-col gap-px border-l border-border p-px"
          onPointerDown={presses.pressSlot}
        >
          {(model.byDay.get(day) ?? [])
            .filter((entry) => entry.start === null)
            .map((entry) => (
              <EntryChip
                key={entry.key}
                entry={entry}
                calendar={model.calendars.get(entry.calendar)}
                zone={zone}
                ghost={layout.drag?.kind === "move" && layout.drag.entry.key === entry.key}
                onOpen={(element) => presses.open(entry, element)}
                onPointerDown={(event) => presses.pressEntry(event, entry, { day, minutes: null })}
              />
            ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Seven days side by side: an all-day row, then a 24-hour grid opened at
 * seven in the morning, or earlier when the week has something earlier.
 */
export function WeekView(layout: LayoutProps) {
  const scroller = useRef<HTMLDivElement>(null);
  // Stepping to another week keeps where the person scrolled; something earlier opens it there.
  const opensAt = openHour(layout);
  useLayoutEffect(() => {
    if (scroller.current !== null) scroller.current.scrollTop = opensAt * HOUR_PX;
  }, [opensAt]);
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-calendar-layout="week">
      <div className="grid grid-cols-[3rem_repeat(7,minmax(0,1fr))] border-b border-border">
        <div />
        {layout.days.map((day, index) => (
          <div
            key={day}
            className="flex flex-col items-center py-1 text-meta sm:flex-row sm:items-baseline sm:justify-center sm:gap-1"
          >
            <span className="text-muted-foreground">{WEEKDAY_SHORT[index]}</span>
            <DayNumber day={day} today={layout.today} />
          </div>
        ))}
      </div>
      <AllDayRow layout={layout} />
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-[3rem_repeat(7,minmax(0,1fr))]">
          <div className="relative" style={{ height: px(DAY_MINUTES) }}>
            {HOURS.slice(1).map((hour) => (
              <span
                key={hour}
                className="absolute right-1 -translate-y-1/2 text-caption text-faint-foreground tabular-nums"
                style={{ top: px(hour * 60) }}
              >
                {String(hour).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          {layout.days.map((day) => (
            <DayColumn key={day} layout={layout} day={day} />
          ))}
        </div>
      </div>
    </div>
  );
}
