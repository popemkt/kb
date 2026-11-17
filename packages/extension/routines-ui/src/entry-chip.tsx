import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { CheckIcon } from "@phosphor-icons/react";
import { calendarChipClass } from "@kb/calendar-kit";
import type { CalendarEntry } from "@kb/routines";
import { cn } from "@kb/ui-sdk";
import { displayTimes } from "./layout";
import { inkOf, type CalendarChoice } from "./model";
import { StatusDot } from "./status-dot";

const STATES = {
  scheduled: "",
  moved: "",
  done: "opacity-60 line-through decoration-foreground/50",
  skipped: "border-dashed opacity-50 line-through",
} as const;

export interface EntryChipProps {
  readonly entry: CalendarEntry;
  readonly calendar: CalendarChoice | undefined;
  readonly zone: string;
  /** Laid out on the week's grid: the time goes above the title, and the chip fills its box. */
  readonly block?: boolean;
  readonly ghost?: boolean;
  readonly style?: CSSProperties;
  readonly onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void;
  /** Opened without a pointer: a key on the focused chip. */
  readonly onOpen: (element: HTMLElement) => void;
}

/** One instance as the month and the week draw it: its calendar's ink, its state, its sync dot. */
export function EntryChip({
  entry,
  calendar,
  zone,
  block = false,
  ghost = false,
  style,
  onPointerDown,
  onOpen,
}: EntryChipProps) {
  const times = displayTimes(entry, zone);
  const label = `${entry.title}${times === null ? ", all day" : `, ${times.start}–${times.end}`}${
    entry.state === "scheduled" ? "" : `, ${entry.state}`
  }`;
  // A press that did not travel opens the chip through the drag; a key opens it here.
  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0) onOpen(event.currentTarget);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === " ") {
      event.preventDefault();
      onOpen(event.currentTarget);
    }
  };
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-entry={entry.key}
      data-entry-state={entry.state}
      style={style}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={cn(
        calendarChipClass,
        block ? "flex-col items-start py-0.5" : "items-center py-px",
        inkOf(calendar),
        STATES[entry.state],
        ghost && "pointer-events-none opacity-40",
      )}
    >
      <span className="flex min-w-0 items-center gap-1">
        <StatusDot status={entry.status} calendarMode={calendar?.mode} />
        {entry.state === "done" ? <CheckIcon size={10} weight="bold" className="shrink-0" /> : null}
        {times !== null && !block ? (
          <span className="shrink-0 text-muted-foreground">{times.start}</span>
        ) : null}
        <span className="min-w-0 truncate">{entry.title === "" ? "Untitled" : entry.title}</span>
      </span>
      {times !== null && block ? (
        <span className="truncate text-muted-foreground">
          {times.start}–{times.end}
        </span>
      ) : null}
    </button>
  );
}
