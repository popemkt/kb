import { useImperativeHandle, useRef, useState } from "react";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { addMonths, formatDay, parseDateInput, parseDay, type LocalDate } from "@kb/model";
import { cn, IconButton, KB_TEXT_CLASS, useAnchoredPosition, type EditHandle } from "@kb/ui-sdk";
import {
  firstDayOfWeek,
  longDateLabel,
  monthLabel,
  todayLocal,
  weekdayInitials,
} from "./date-display.ts";
import { calendarWeeks, dateMoveOf, sameDay } from "./date-calendar";

export interface DateEditorProps {
  /** What the input starts with: the stored date, or input the slot kept. */
  initialText: string;
  /** Leave with what is typed (or picked): the slot parses and commits it. */
  onCommit: (text: string) => void;
  /** Leave without changing anything. */
  onCancel: () => void;
  /** The editor's side of the value slot's keymap: the slot's Enter, Tab and Escape land here. */
  handleRef?: React.Ref<EditHandle>;
}

/**
 * A date, typed or picked: a text input that reads phrases (`tomorrow`,
 * `next fri`, `oct 3`, `in 2 weeks` — `parseDateInput`, the reader every
 * surface shares) with a live preview of the date it names, over a calendar
 * that follows it. Keyboard-first: ↑/↓ move a day, ⇧↑/⇧↓ a week,
 * PageUp/PageDown a month; the pointer picks a day. Every other key is the
 * value slot's, as on any value: Enter sets the date (and, at the end of a
 * many-valued field's, opens the next value), Tab sets it and moves on,
 * Escape leaves. The calendar is anchored below the input and flips above
 * it when there is no room.
 */
export function DateEditor({ initialText, onCommit, onCancel, handleRef }: DateEditorProps) {
  const today = todayLocal();
  const [text, setText] = useState(initialText);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const place = useAnchoredPosition(inputRef, panelRef, true);

  const typed = parseDateInput(text, today);
  const preview = typed === null ? null : parseDay(typed);
  /** The date keys move from: what is typed, else today. */
  const current = preview ?? today;
  /** The month the calendar shows: the typed date's, until the arrows page it. */
  const [month, setShownMonth] = useState<LocalDate>(current);

  const setDate = (date: LocalDate) => {
    setText(formatDay(date));
    setShownMonth(date);
  };

  /**
   * The editor is left once: by a commit, a cancel or a pick. The focus
   * moving on after a cancel blurs the input while it is still drawn, and
   * that blur must not keep what the cancel put back.
   */
  const left = useRef(false);
  const leave = (how: () => void) => {
    if (left.current) return;
    left.current = true;
    how();
  };
  /** Leave with what is typed, or — nothing changed — without a write. */
  const finish = () => leave(() => (text === initialText ? onCancel() : onCommit(text)));
  const cancel = () => leave(onCancel);

  useImperativeHandle(handleRef, () => ({
    commit: finish,
    cancel,
    softBreak: () => undefined,
    atEnd: () => {
      const at = inputRef.current?.selectionStart ?? text.length;
      return text.trim() !== "" && at >= text.length;
    },
    caret: () => ({ at: inputRef.current?.selectionStart ?? text.length, length: text.length }),
    caretAtPoint: () => "end",
  }));

  return (
    <div className="relative min-w-0 flex-1" data-date-editor="true">
      <input
        ref={inputRef}
        type="text"
        value={text}
        placeholder="today, next fri, oct 3…"
        aria-label="Date"
        aria-invalid={text.trim() !== "" && preview === null ? true : undefined}
        className={cn(
          "w-full rounded-sm border-none bg-transparent px-1 outline-none",
          KB_TEXT_CLASS,
          "text-foreground/70 placeholder:text-faint-foreground",
        )}
        autoFocus
        onChange={(e) => {
          setText(e.target.value);
          const named = parseDateInput(e.target.value, today);
          const date = named === null ? null : parseDay(named);
          if (date !== null) setShownMonth(date);
        }}
        onBlur={finish}
        onKeyDown={(e) => {
          // A move is the editor's; any other key goes on to the slot.
          const move = dateMoveOf(e);
          if (move === null) return;
          e.stopPropagation();
          e.preventDefault();
          setDate(move(current));
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Calendar"
        className={cn(
          "z-30 w-60 overflow-auto rounded-lg border border-border bg-popover p-2 shadow-overlay",
          place === undefined && "absolute left-0 top-full mt-1",
        )}
        style={place}
        // The input keeps focus: a click in the calendar must not blur it.
        onMouseDown={(e) => e.preventDefault()}
      >
        <p
          className={cn(
            "mb-1.5 truncate px-1 text-meta",
            preview === null && text.trim() !== "" ? "text-warning" : "text-foreground/50",
          )}
          data-date-preview="true"
        >
          {preview !== null
            ? longDateLabel(preview)
            : text.trim() === ""
              ? "Type a date, or pick one"
              : "Not a date yet"}
        </p>
        <CalendarMonth
          month={month}
          picked={preview}
          today={today}
          onPage={(n) => setShownMonth(addMonths(month, n))}
          onPick={(day) => leave(() => onCommit(formatDay(day)))}
        />
        <p className="mt-1.5 px-1 text-caption text-foreground/25">
          ↑↓ day · ⇧↑↓ week · PgUp/PgDn month · ↵ set · esc
        </p>
      </div>
    </div>
  );
}

/** A month of days: its name and paging, the weekday heads, and a button per day. */
function CalendarMonth({
  month,
  picked,
  today,
  onPage,
  onPick,
}: {
  month: LocalDate;
  picked: LocalDate | null;
  today: LocalDate;
  onPage: (months: number) => void;
  onPick: (day: LocalDate) => void;
}) {
  const firstDay = firstDayOfWeek();
  return (
    <>
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-ui font-medium text-foreground/75">{monthLabel(month)}</span>
        <span className="flex gap-0.5">
          <IconButton
            label="Previous month"
            icon={CaretLeftIcon}
            tabIndex={-1}
            onClick={() => onPage(-1)}
          />
          <IconButton
            label="Next month"
            icon={CaretRightIcon}
            tabIndex={-1}
            onClick={() => onPage(1)}
          />
        </span>
      </div>
      <div role="grid" aria-label={monthLabel(month)} className="grid grid-cols-7 gap-px">
        {weekdayInitials(firstDay).map((initial, i) => (
          // oxlint-disable-next-line react/no-array-index-key -- a weekday's column is its identity
          <span key={i} className="py-0.5 text-center text-caption text-foreground/30">
            {initial}
          </span>
        ))}
        {calendarWeeks(month, firstDay)
          .flat()
          .map((day) => {
            const isPicked = picked !== null && sameDay(day, picked);
            const inMonth = day.month === month.month;
            return (
              <button
                key={formatDay(day)}
                type="button"
                tabIndex={-1}
                role="gridcell"
                aria-selected={isPicked}
                aria-label={longDateLabel(day)}
                data-date={formatDay(day)}
                className={cn(
                  "h-7 rounded-md text-center text-meta tabular-nums transition-colors duration-75",
                  isPicked
                    ? "bg-accent text-accent-foreground font-medium"
                    : inMonth
                      ? "text-foreground/75 hover:bg-foreground/[0.06]"
                      : "text-foreground/25 hover:bg-foreground/[0.04]",
                  sameDay(day, today) && !isPicked && "ring-1 ring-primary/40",
                )}
                onClick={() => onPick(day)}
              >
                {day.day}
              </button>
            );
          })}
      </div>
    </>
  );
}
