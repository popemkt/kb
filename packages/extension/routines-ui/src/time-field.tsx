/**
 * A time of day, typed or picked: a text field that reads what is typed
 * ("9", "930", "9:30pm", "21:30") as it is typed, with a list of times every
 * quarter hour under it. Arrow keys move through the list, Enter picks the
 * time marked, Escape closes the list and keeps the field; with the list
 * shut, Enter is the form's. The field says when its text is not a time,
 * and keeps the last time it read until it is one.
 */
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { cn, useAnchoredPosition, useDismiss } from "@kb/ui-sdk";
import { FIELD_CLASS } from "./repeat-picker";
import { parseTime, TIMES } from "./time-text";

/** The listed time at or after `time`: where the list opens for it. */
const nearest = (time: string) =>
  TIMES.find((each) => each >= time) ?? TIMES[TIMES.length - 1] ?? time;

/** The day's times, listed from the one after `after` round to it; from midnight with none. */
function listedAfter(after: string | undefined): readonly string[] {
  if (after === undefined) return TIMES;
  const at = TIMES.indexOf(nearest(after)) + 1;
  return [...TIMES.slice(at), ...TIMES.slice(0, at)];
}

export function TimeField({
  label,
  value,
  onChange,
  onText,
  hint,
  after,
  className,
}: {
  readonly label: string;
  /** The time it holds, `HH:MM`. */
  readonly value: string;
  readonly onChange: (time: string) => void;
  /** Whether what is typed now reads as a time. */
  readonly onText?: (readable: boolean) => void;
  /** What each listed time adds, beside it (how long, for an end time). */
  readonly hint?: (time: string) => string;
  /** The list starts just after this time (an end time's start), else at midnight. */
  readonly after?: string;
  readonly className?: string;
}) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [marked, setMarked] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const style = useAnchoredPosition(input, list, open);
  useDismiss(open, { inside: [list], trigger: input }, () => setOpen(false));
  // A time set from outside (the start moved, a default) is shown as it is.
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    if (parseTime(text) !== value) setText(value);
  }
  useLayoutEffect(() => {
    if (open)
      list.current?.querySelector(`[data-time="${marked}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, marked]);
  const type = (next: string) => {
    setText(next);
    const read = parseTime(next);
    onText?.(read !== null);
    if (read !== null) {
      onChange(read);
      setMarked(nearest(read));
    }
  };
  const pick = (time: string) => {
    setText(time);
    onText?.(true);
    onChange(time);
    setOpen(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const listed = listedAfter(after);
    const at = listed.indexOf(marked);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setMarked(nearest(value));
        setOpen(true);
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setMarked(listed[(at + step + listed.length) % listed.length] ?? marked);
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      pick(marked);
    }
  };
  const readable = parseTime(text) !== null;
  return (
    <>
      <input
        ref={input}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${id}-${marked}` : undefined}
        aria-invalid={!readable}
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        className={cn(
          FIELD_CLASS,
          "w-24 font-mono tabular-nums",
          !readable && "border-destructive",
          className,
        )}
        value={text}
        onChange={(event) => type(event.target.value)}
        onFocus={() => setMarked(nearest(value))}
        onClick={() => setOpen(!open)}
        onBlur={() => {
          if (readable) setText(parseTime(text) ?? value);
        }}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <TimeList
          ref={list}
          id={id}
          label={label}
          times={listedAfter(after)}
          marked={marked}
          hint={hint}
          onPick={pick}
          style={style}
        />
      ) : null}
    </>
  );
}

/** The times listed under a time field, the marked one highlighted. */
function TimeList({
  ref: listRef,
  id,
  label,
  times,
  marked,
  hint,
  onPick,
  style,
}: {
  readonly ref: RefObject<HTMLUListElement | null>;
  readonly id: string;
  readonly label: string;
  readonly times: readonly string[];
  readonly marked: string;
  readonly hint: ((time: string) => string) | undefined;
  readonly onPick: (time: string) => void;
  readonly style: CSSProperties | undefined;
}) {
  return (
    <ul
      ref={listRef}
      id={id}
      role="listbox"
      aria-label={label}
      data-time-list=""
      className="fixed z-[60] max-h-56 w-40 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-overlay"
      style={style}
    >
      {times.map((time) => (
        <li
          key={time}
          id={`${id}-${time}`}
          role="option"
          aria-selected={time === marked}
          data-time={time}
          className={cn(
            "flex cursor-pointer items-baseline justify-between gap-2 rounded-sm px-2 py-0.5 font-mono text-label tabular-nums text-foreground",
            time === marked ? "bg-accent" : "hover:bg-accent",
          )}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => onPick(time)}
        >
          {time}
          {hint === undefined ? null : (
            <span className="font-sans text-caption text-foreground">{hint(time)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
