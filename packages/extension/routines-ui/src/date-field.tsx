/**
 * A day, picked from a month: a button that names the day and opens a small
 * month under it. The month is keyboard-first — arrows move a day or a week,
 * Page Up and Page Down a month, Home and End the week's ends, Enter or Space
 * picks — and it dismisses as every popover does (Escape gives focus back to
 * the button, a press outside closes it), so Escape inside the editor closes
 * the month before the editor.
 */
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { CalendarBlankIcon, CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { addDays, formatDay, parseDay } from "@kb/model";
import { cn, IconButton, useAnchoredPosition, useDismiss } from "@kb/ui-sdk";
import { daysOf, longDay, sameMonth, stepAnchor, titleOf, WEEKDAY_SHORT } from "@kb/calendar-kit";
import { FIELD_CLASS } from "./repeat-picker";

const shift = (day: string, days: number) => {
  const local = parseDay(day);
  return local === null ? day : formatDay(addDays(local, days));
};

/** Where each key moves the day in focus: by days, or by a layout step of months. */
const MOVES: Readonly<Record<string, (day: string) => string>> = {
  ArrowLeft: (day) => shift(day, -1),
  ArrowRight: (day) => shift(day, 1),
  ArrowUp: (day) => shift(day, -7),
  ArrowDown: (day) => shift(day, 7),
  PageUp: (day) => stepAnchor("month", day, -1),
  PageDown: (day) => stepAnchor("month", day, 1),
  Home: (day) => daysOf("week", day)[0] ?? day,
  End: (day) => daysOf("week", day)[6] ?? day,
};

/** A day of the month grid: picked, in the month shown, or outside it. */
type DayTone = "picked" | "month" | "outside";

const DAY_CELL =
  "h-7 rounded-md text-label tabular-nums outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** One day to pick; each tone is its own element, so its text is read on its own ground. */
function DayCell({
  day,
  tone,
  today,
  focused,
  onPick,
}: {
  readonly day: string;
  readonly tone: DayTone;
  readonly today: boolean;
  readonly focused: boolean;
  readonly onPick: (day: string) => void;
}) {
  const own = {
    role: "gridcell",
    "data-day": day,
    "aria-selected": tone === "picked",
    "aria-label": `${longDay(day)}${today ? ", today" : ""}`,
    tabIndex: focused ? 0 : -1,
    onClick: () => onPick(day),
  } as const;
  const number = Number(day.slice(8));
  if (tone === "picked")
    return (
      <button type="button" {...own} className={cn(DAY_CELL, "bg-primary text-primary-foreground")}>
        {number}
      </button>
    );
  if (tone === "outside")
    return (
      <button
        type="button"
        {...own}
        className={cn(DAY_CELL, "text-muted-foreground hover:ring-1 hover:ring-border")}
      >
        {number}
      </button>
    );
  return (
    <button
      type="button"
      {...own}
      className={cn(
        DAY_CELL,
        "text-foreground hover:bg-accent",
        today && "font-semibold underline underline-offset-2",
      )}
    >
      {number}
    </button>
  );
}

function Month({
  value,
  today,
  onPick,
}: {
  readonly value: string;
  readonly today: string;
  readonly onPick: (day: string) => void;
}) {
  const [focused, setFocused] = useState(value === "" ? today : value);
  const grid = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    grid.current?.querySelector<HTMLElement>(`[data-day="${focused}"]`)?.focus();
  }, [focused]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const move = MOVES[event.key];
    if (move === undefined) return;
    event.preventDefault();
    setFocused(move(focused));
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <IconButton
          label="Previous month"
          icon={CaretLeftIcon}
          size="md"
          onClick={() => setFocused(stepAnchor("month", focused, -1))}
        />
        <span className="flex-1 text-center text-label text-foreground" aria-live="polite">
          {titleOf("month", focused)}
        </span>
        <IconButton
          label="Next month"
          icon={CaretRightIcon}
          size="md"
          onClick={() => setFocused(stepAnchor("month", focused, 1))}
        />
      </div>
      <div
        ref={grid}
        role="grid"
        aria-label={titleOf("month", focused)}
        className="grid grid-cols-7 gap-px"
        onKeyDown={onKeyDown}
      >
        {WEEKDAY_SHORT.map((name) => (
          <span
            key={name}
            role="columnheader"
            className="py-0.5 text-center text-caption text-muted-foreground"
          >
            {name.slice(0, 2)}
          </span>
        ))}
        {daysOf("month", focused).map((day) => (
          <DayCell
            key={day}
            day={day}
            tone={day === value ? "picked" : sameMonth(day, focused) ? "month" : "outside"}
            today={day === today}
            focused={day === focused}
            onPick={onPick}
          />
        ))}
      </div>
    </div>
  );
}

export function DateField({
  label,
  value,
  today,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly today: string;
  readonly onChange: (day: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const style = useAnchoredPosition(button, panel, open);
  useDismiss(open, { inside: [panel], trigger: button }, () => setOpen(false));
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-value={value}
        className={cn(FIELD_CLASS, "inline-flex items-center gap-1.5 text-left")}
        onClick={() => setOpen(!open)}
      >
        <CalendarBlankIcon size={14} className="shrink-0 text-muted-foreground" aria-hidden />
        <span className={cn("truncate", value === "" && "text-muted-foreground")}>
          {value === "" ? "Choose a day" : `${longDay(value)}, ${value.slice(0, 4)}`}
        </span>
      </button>
      {open ? (
        <div
          ref={panel}
          role="dialog"
          aria-label={`${label}: choose a day`}
          data-date-picker=""
          className="fixed z-[60] w-64 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-overlay"
          style={style}
        >
          <Month
            value={value}
            today={today}
            onPick={(day) => {
              onChange(day);
              setOpen(false);
              button.current?.focus();
            }}
          />
        </div>
      ) : null}
    </>
  );
}
