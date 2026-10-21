/**
 * The kb functions (`KB_FUNCTIONS`): what each answers, and the input each is
 * bound to in a compiled query. Pure over one `ClockSample`, so every
 * function in a run agrees on "now" and a test pins it; the executor takes
 * that sample once per run (DESIGN.md → Query layer).
 */
import { addDays, dayAt, formatDay, isoFromMillis, type ClockSample } from "@kb/model";
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
