/**
 * The repeat picker's model: the rules a person picks from by name, read back
 * from and written to the routine's one RRULE. A rule the picker cannot name
 * stays as it is, edited as text. Every rule it writes is a canonical rule
 * the projection sends unchanged.
 */
import { addDays, dayNumber, formatDay, parseDay, weekday, type LocalDate } from "@kb/model";
import { SyncError } from "./model.ts";
import { canonicalRule } from "./projection.ts";

export const FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;
export type Frequency = (typeof FREQUENCIES)[number];
/** RRULE weekdays, Monday first. */
export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** A rule the picker can say: how often, every how many, on which days, how many times. */
export interface Repeat {
  readonly freq: Frequency;
  readonly interval: number;
  /** Weekly: the days it falls on, the start's own when empty. */
  readonly byDay: readonly Weekday[];
  /** Monthly: on the start's day of the month, or on its weekday's place in the month. */
  readonly monthly: "day" | "weekday";
  readonly count: number | null;
}

const invalid = () => new SyncError({ status: 400, code: "invalid_rule" });
const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const ORDINALS = ["first", "second", "third", "fourth", "fifth"] as const;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
const UNITS: Readonly<Record<Frequency, string>> = {
  DAILY: "day",
  WEEKLY: "week",
  MONTHLY: "month",
  YEARLY: "year",
};

function startDay(starts: string): LocalDate {
  const day = parseDay(starts);
  if (day === null) throw invalid();
  return day;
}

/** The RRULE weekday a date falls on. */
export function weekdayOf(date: LocalDate): Weekday {
  return WEEKDAYS[(weekday(date) + 6) % 7] ?? "MO";
}

/** Which of its weekday a date is in its month: 1…3, or -1 when it is the month's last. */
function placeInMonth(date: LocalDate): number {
  return addDays(date, 7).month === date.month ? Math.ceil(date.day / 7) : -1;
}

function entries(rule: string): ReadonlyMap<string, string> {
  return new Map(
    canonicalRule(rule)
      .replace(/^RRULE:/, "")
      .split(";")
      .map((part) => {
        const [key = "", value = ""] = part.split("=");
        return [key, value] as const;
      }),
  );
}

function parsedRule(rrule: string): ReadonlyMap<string, string> | null {
  if (rrule.trim() === "") return null;
  try {
    return entries(rrule);
  } catch {
    return null;
  }
}

const PICKER_KEYS = new Set(["FREQ", "INTERVAL", "COUNT", "BYDAY", "BYMONTHDAY", "BYMONTH"]);

/**
 * The days part of a rule the picker can say for a start on `date`: weekly
 * weekdays, or a month (and year) placed on the start's day or its weekday's
 * place in the month. Null for anything else.
 */
function pickerDays(
  freq: Frequency,
  parts: ReadonlyMap<string, string>,
  date: LocalDate,
): Pick<Repeat, "byDay" | "monthly"> | null {
  const byDay = parts.get("BYDAY")?.split(",") ?? [];
  const monthDay = parts.get("BYMONTHDAY");
  const month = parts.get("BYMONTH");
  const plain = { byDay: [], monthly: "day" } as const;
  if (freq === "DAILY" || freq === "WEEKLY") return weekDays(freq, byDay, monthDay ?? month);
  if (month !== undefined && !(freq === "YEARLY" && Number(month) === date.month)) return null;
  if (monthDay !== undefined)
    return byDay.length === 0 && Number(monthDay) === date.day ? plain : null;
  if (byDay.length === 0) return plain;
  return freq === "MONTHLY" && byDay.length === 1 && onPlaceOf(byDay[0] ?? "", date)
    ? { ...plain, monthly: "weekday" }
    : null;
}

/** A daily or weekly rule's days: plain weekdays for a weekly one, none for a daily one. */
function weekDays(
  freq: "DAILY" | "WEEKLY",
  byDay: readonly string[],
  monthPart: string | undefined,
): Pick<Repeat, "byDay" | "monthly"> | null {
  const days = WEEKDAYS.filter((day) => byDay.includes(day));
  if (monthPart !== undefined || days.length !== byDay.length) return null;
  if (freq === "DAILY" && days.length > 0) return null;
  return { byDay: days, monthly: "day" };
}

/** Whether an ordinal BYDAY (`-1FR`, `+2WE`) names `date`'s weekday at its place in the month. */
function onPlaceOf(byDay: string, date: LocalDate): boolean {
  const ordinal = /^([+-]?\d+)(MO|TU|WE|TH|FR|SA|SU)$/.exec(byDay);
  return (
    ordinal !== null && Number(ordinal[1]) === placeInMonth(date) && ordinal[2] === weekdayOf(date)
  );
}

/** The rule the picker reads in `rrule`, or null when it is not one it can say. */
export function readRepeat(rrule: string, starts: string): Repeat | null {
  const parts = parsedRule(rrule);
  const date = parseDay(starts);
  const freq = FREQUENCIES.find((value) => value === parts?.get("FREQ"));
  if (parts === null || date === null || freq === undefined) return null;
  if ([...parts.keys()].some((key) => !PICKER_KEYS.has(key))) return null;
  const days = pickerDays(freq, parts, date);
  if (days === null) return null;
  const count = parts.get("COUNT");
  return {
    freq,
    interval: Number(parts.get("INTERVAL") ?? "1"),
    count: count === undefined ? null : Number(count),
    ...days,
  };
}

/** The canonical RRULE for `repeat` from `starts`; what the start already says is left implicit. */
export function repeatRule(repeat: Repeat, starts: string): string {
  const date = startDay(starts);
  const parts = ["FREQ=" + repeat.freq];
  if (repeat.interval > 1) parts.push("INTERVAL=" + String(repeat.interval));
  if (repeat.freq === "WEEKLY") {
    const days = WEEKDAYS.filter((day) => repeat.byDay.includes(day));
    if (days.length > 0 && !(days.length === 1 && days[0] === weekdayOf(date)))
      parts.push("BYDAY=" + days.join(","));
  }
  if (repeat.freq === "MONTHLY" && repeat.monthly === "weekday")
    parts.push("BYDAY=" + String(placeInMonth(date)) + weekdayOf(date));
  if (repeat.count !== null) parts.push("COUNT=" + String(repeat.count));
  return canonicalRule(parts.join(";")).replace(/^RRULE:/, "");
}

/** One of the picker's named choices, for a routine starting on `starts`. */
export interface RepeatPreset {
  readonly id: string;
  readonly label: string;
  /** The rule it writes; empty for a one-off. */
  readonly rrule: string;
}

/** The named choices the picker offers for a routine starting on `starts`. */
export function repeatPresets(starts: string): readonly RepeatPreset[] {
  const date = startDay(starts);
  const day = WEEKDAY_NAMES[(weekday(date) + 6) % 7] ?? "Mon";
  const place = placeInMonth(date);
  const rule = (repeat: Partial<Repeat> & Pick<Repeat, "freq">) =>
    repeatRule({ interval: 1, byDay: [], monthly: "day", count: null, ...repeat }, starts);
  return [
    { id: "none", label: "Does not repeat", rrule: "" },
    { id: "daily", label: "Daily", rrule: rule({ freq: "DAILY" }) },
    { id: "weekly", label: "Weekly on " + day, rrule: rule({ freq: "WEEKLY" }) },
    {
      id: "weekdays",
      label: "Every weekday (Mon–Fri)",
      rrule: rule({ freq: "WEEKLY", byDay: ["MO", "TU", "WE", "TH", "FR"] }),
    },
    {
      id: "monthly",
      label: "Monthly on day " + String(date.day),
      rrule: rule({ freq: "MONTHLY" }),
    },
    {
      id: "monthly-weekday",
      label: "Monthly on the " + (place === -1 ? "last" : ORDINALS[place - 1]) + " " + day,
      rrule: rule({ freq: "MONTHLY", monthly: "weekday" }),
    },
    {
      id: "yearly",
      label: "Yearly on " + MONTHS[date.month - 1] + " " + String(date.day),
      rrule: rule({ freq: "YEARLY" }),
    },
  ];
}

/** How a routine's repeat reads in a sentence: its rule, then its end. */
export function describeRepeat(rrule: string, until: string, starts: string): string {
  if (rrule.trim() === "") return "Does not repeat";
  const repeat = readRepeat(rrule, starts);
  const end = until === "" ? "" : ", until " + until;
  if (repeat === null) return "Custom rule" + end;
  const preset = repeatPresets(starts).find(
    (choice) =>
      choice.rrule !== "" && choice.rrule === repeatRule({ ...repeat, count: null }, starts),
  );
  const unit = UNITS[repeat.freq];
  let text =
    preset?.label ??
    (repeat.interval === 1
      ? "Every " + unit
      : "Every " + String(repeat.interval) + " " + unit + "s");
  if (preset === undefined && repeat.freq === "WEEKLY" && repeat.byDay.length > 0)
    text +=
      " on " + repeat.byDay.map((day) => WEEKDAY_NAMES[WEEKDAYS.indexOf(day)] ?? day).join(", ");
  if (repeat.count !== null) text += ", " + String(repeat.count) + " times";
  return text + end;
}

/** A weekday's place in the week, Monday 0. */
const weekIndex = (day: string): number => WEEKDAYS.findIndex((name) => name === day);

/**
 * A weekly rule's days turned by `days`, or null when turning them breaks an
 * interval's weeks: every second week, a day turned past Sunday lands in a
 * week the rule skips, unless every day (and the start) crosses together.
 */
function turnedWeek(
  byDay: string | undefined,
  interval: number,
  start: LocalDate,
  days: number,
): string | null | undefined {
  const turned = (byDay ?? "").split(",").filter((day) => day !== "");
  const indexes = [...turned.map(weekIndex), weekIndex(weekdayOf(start))];
  if (interval > 1 && new Set(indexes.map((index) => Math.floor((index + days) / 7))).size > 1)
    return null;
  if (byDay === undefined) return undefined;
  return turned.map((day) => WEEKDAYS[(((weekIndex(day) + days) % 7) + 7) % 7]).join(",");
}

/**
 * A month's day moved by `days`, or null when it leaves the days every month
 * has (1…28): then moving by days changes which months it falls in.
 */
function movedMonthDays(monthDays: readonly number[], days: number): string | null {
  const moved = monthDays.map((day) => day + days);
  return [...monthDays, ...moved].some((day) => day < 1 || day > 28) ? null : moved.join(",");
}

/**
 * The rule a series has once every instance moves `days` days from `starts`:
 * the same rule when the start carries its days, its weekdays turned for a
 * weekly rule, its day of the month moved while it stays inside every month;
 * null when moving by days changes what the rule says, which only an edit can
 * decide.
 */
export function shiftRule(rrule: string, starts: string, days: number): string | null {
  if (rrule.trim() === "" || days === 0) return rrule;
  const parts = entries(rrule);
  const freq = parts.get("FREQ");
  const byDay = parts.get("BYDAY");
  const monthDay = parts.get("BYMONTHDAY");
  if (parts.has("BYSETPOS") || parts.has("BYMONTH")) return null;
  if (byDay !== undefined && freq !== "WEEKLY") return null;
  const start = startDay(starts);
  const next = new Map(parts);
  if (freq === "WEEKLY") {
    const turned = turnedWeek(byDay, Number(parts.get("INTERVAL") ?? "1"), start, days);
    if (turned === null) return null;
    if (turned !== undefined) next.set("BYDAY", turned);
  }
  // A day of the month moves whatever the frequency; without one a monthly or
  // yearly rule implies the start's, which moves the same way.
  const implied = monthDay === undefined && (freq === "MONTHLY" || freq === "YEARLY");
  if (monthDay !== undefined || implied) {
    const moved = movedMonthDays((monthDay ?? String(start.day)).split(",").map(Number), days);
    if (moved === null) return null;
    if (monthDay !== undefined) next.set("BYMONTHDAY", moved);
  }
  return canonicalRule([...next].map(([key, value]) => key + "=" + value).join(";")).replace(
    /^RRULE:/,
    "",
  );
}

/** The day `days` days after `day`. */
export function shiftDay(day: string, days: number): string {
  return formatDay(addDays(startDay(day), days));
}

/** Days from `from` to `to`. */
export function daysBetween(from: string, to: string): number {
  return dayNumber(startDay(to)) - dayNumber(startDay(from));
}
