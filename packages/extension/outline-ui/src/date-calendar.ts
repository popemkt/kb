/**
 * A date editor's month grid and its keys, as data (the pure half of
 * `date-editor`).
 */
import { addDays, addMonths, weekday, type LocalDate } from "@kb/model";
import { lookupChord, type Chord, type KeyChordEvent } from "@kb/keybindings";

/** Six weeks covering `month`'s month, each starting on `firstDay` (0 = Sunday). */
export function calendarWeeks(month: LocalDate, firstDay: number): LocalDate[][] {
  const first = { ...month, day: 1 };
  const start = addDays(first, -((weekday(first) - firstDay + 7) % 7));
  return Array.from({ length: 6 }, (_week, w) =>
    Array.from({ length: 7 }, (_day, d) => addDays(start, w * 7 + d)),
  );
}

export const sameDay = (a: LocalDate, b: LocalDate): boolean =>
  a.year === b.year && a.month === b.month && a.day === b.day;

/** What a key does to the date an editor is about to set: moves it. */
export type DateMove = (date: LocalDate) => LocalDate;

interface DateBinding {
  readonly chord: Chord;
  readonly move: DateMove;
}

/**
 * ↑/↓ a day, ⇧↑/⇧↓ a week, PageUp/PageDown a month. These are the date
 * editor's own; Enter, Tab and Escape are the value slot's, as on every
 * value (`value-slot-keymap`), and ←/→ stay the text's, for editing what
 * was typed.
 */
const DATE_KEYS: readonly DateBinding[] = [
  { chord: { key: "ArrowUp", shift: true }, move: (d) => addDays(d, -7) },
  { chord: { key: "ArrowDown", shift: true }, move: (d) => addDays(d, 7) },
  { chord: { key: "ArrowUp" }, move: (d) => addDays(d, -1) },
  { chord: { key: "ArrowDown" }, move: (d) => addDays(d, 1) },
  { chord: { key: "PageUp" }, move: (d) => addMonths(d, -1) },
  { chord: { key: "PageDown" }, move: (d) => addMonths(d, 1) },
];

export function dateMoveOf(event: KeyChordEvent): DateMove | null {
  return lookupChord(event, DATE_KEYS)?.move ?? null;
}
