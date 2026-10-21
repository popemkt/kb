/**
 * The kb functions (`KB_FUNCTIONS`): what each answers, and the input each is
 * bound to in a compiled query. Pure over one `ClockSample`, so every
 * function in a run agrees on "now" and a test pins it; the executor takes
 * that sample once per run (DESIGN.md → Query layer).
 */
import { addDays, dayAt, dayNumber, formatDay, isoFromMillis, type ClockSample } from "@kb/model";
import { KB_FUNCTIONS, type KbFunctionName } from "./ir.ts";

const DAY_MS = 86_400_000;

const KB_FUNCTION_NAMES: ReadonlySet<string> = new Set(KB_FUNCTIONS);

export function isKbFunction(name: string): name is KbFunctionName {
  return KB_FUNCTION_NAMES.has(name);
}

/** The functions that read the clock; a run that calls none of them takes no sample. */
const CLOCKED: ReadonlySet<KbFunctionName> = new Set([
  "kb/today",
  "kb/date-in-days",
  "kb/instant-now",
  "kb/instant-days-ago",
]);

export function readsClock(name: KbFunctionName): boolean {
  return CLOCKED.has(name);
}

/** The functions that answer a civil date: their answer holds until the sample's next local midnight. */
const CIVIL: ReadonlySet<KbFunctionName> = new Set(["kb/today", "kb/date-in-days"]);

/**
 * How long an answer that read an instant (`kb/instant-now`,
 * `kb/instant-days-ago`) holds before it is asked again: an instant moves
 * continuously, so its answer is refreshed on a cadence rather than at a
 * boundary.
 */
const INSTANT_REFRESH_MS = 60_000;

/**
 * Until when (epoch ms) a run's answer holds, given the kb functions it
 * called and the clock sample it took: null when it read no clock (it holds
 * until the graph moves), the sample's next local midnight when it read a
 * civil date, and {@link INSTANT_REFRESH_MS} on when it read an instant;
 * the earliest of those that apply.
 */
export function holdsUntil(
  names: readonly KbFunctionName[],
  sample: ClockSample | undefined,
): number | null {
  if (sample === undefined) return null;
  const bounds: number[] = [];
  if (names.some((name) => CIVIL.has(name))) bounds.push(nextMidnight(sample));
  if (names.some((name) => readsClock(name) && !CIVIL.has(name))) {
    bounds.push(sample.nowMs + INSTANT_REFRESH_MS);
  }
  return bounds.length === 0 ? null : Math.min(...bounds);
}

/**
 * The first millisecond after `sample` whose civil date in its zone is a
 * later day: found by bisection, since a zone's day can be 23 or 25 hours
 * long across a transition.
 */
function nextMidnight(sample: ClockSample): number {
  const day = (ms: number): number => {
    const date = dayAt(ms, sample.timeZone);
    if (date === null) throw new Error(`${sample.timeZone} is not a time zone`);
    return dayNumber(date);
  };
  const today = day(sample.nowMs);
  let before = sample.nowMs;
  let after = sample.nowMs + 2 * DAY_MS;
  while (after - before > 1) {
    const mid = Math.floor((before + after) / 2);
    if (day(mid) > today) after = mid;
    else before = mid;
  }
  return after;
}

/** The `:in` variable `compile` binds `name` to (`kb/includes-ci?` → `?__kb_fn_includes-ci_q`), without the `?`. */
export function kbFunctionInput(name: KbFunctionName): string {
  return `__kb_fn_${name.slice("kb/".length).replaceAll("?", "_q")}`;
}

type KbFunction = (...args: unknown[]) => unknown;

/** A whole number of days, or the error DataScript reports as the query's. */
function days(name: KbFunctionName, n: unknown): number {
  if (typeof n !== "number" || !Number.isSafeInteger(n)) {
    throw new Error(`${name} takes a whole number of days, got ${String(n)}`);
  }
  return n;
}

/** `sample`'s civil date, `n` days on, in its zone, as `YYYY-MM-DD`. */
function civilDay(name: KbFunctionName, sample: ClockSample, n: number): string {
  const today = dayAt(sample.nowMs, sample.timeZone);
  if (today === null) throw new Error(`${name}: ${sample.timeZone} is not a time zone`);
  return formatDay(addDays(today, n));
}

/**
 * Every kb function over one clock sample:
 *
 * - `(kb/includes-ci? s sub)`: `s` contains `sub`, ignoring case; false when
 *   either is not a string.
 * - `(kb/today)`, `(kb/date-in-days n)`: the civil date, `YYYY-MM-DD` in the
 *   sample's zone, today and `n` days on; dates kb stores compare with them
 *   as strings.
 * - `(kb/instant-now)`, `(kb/instant-days-ago n)`: the instant, ISO-8601 in
 *   UTC as `currentIso` writes `created`/`edited`, now and `n`·24 h before.
 *
 * `sample` may be absent only for a run that calls no clocked function
 * (`readsClock`); a clocked one then fails naming itself.
 */
export function kbFunctions(sample: ClockSample | undefined): {
  readonly [K in KbFunctionName]: KbFunction;
} {
  const clock = (name: KbFunctionName): ClockSample => {
    if (sample === undefined) {
      throw new Error(`${name} reads the clock, and this run was given none`);
    }
    return sample;
  };
  return {
    "kb/includes-ci?": (s, sub) =>
      typeof s === "string" &&
      typeof sub === "string" &&
      s.toLowerCase().includes(sub.toLowerCase()),
    "kb/today": () => civilDay("kb/today", clock("kb/today"), 0),
    "kb/date-in-days": (n) =>
      civilDay("kb/date-in-days", clock("kb/date-in-days"), days("kb/date-in-days", n)),
    "kb/instant-now": () => isoFromMillis(clock("kb/instant-now").nowMs),
    "kb/instant-days-ago": (n) =>
      isoFromMillis(clock("kb/instant-days-ago").nowMs - days("kb/instant-days-ago", n) * DAY_MS),
  };
}
