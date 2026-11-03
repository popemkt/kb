import { DateTime, Duration, Effect } from "effect";
import { addDays, canonicalJson, conformsToType, formatDay, parseDay } from "@kb/model";
import {
  SyncError,
  type EventFields,
  type EventTime,
  type ProjectionTarget,
  type Routine,
} from "./model.ts";
import { RRule } from "./rrule.ts";

const RULE_KEYS = new Set([
  "FREQ",
  "INTERVAL",
  "BYDAY",
  "BYMONTHDAY",
  "BYMONTH",
  "BYSETPOS",
  "COUNT",
  "UNTIL",
]);
const FREQUENCIES = new Set(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);

const invalid = () => new SyncError({ status: 400, code: "invalid_rule" });

function day(value: string) {
  const parsed = parseDay(value);
  if (parsed === null) throw invalid();
  return parsed;
}

const NUMERIC_RANGES = new Map<string, readonly [number, number]>([
  ["INTERVAL", [1, Number.MAX_SAFE_INTEGER]],
  ["COUNT", [1, Number.MAX_SAFE_INTEGER]],
  ["BYMONTH", [1, 12]],
  ["BYMONTHDAY", [-31, 31]],
  ["BYSETPOS", [-366, 366]],
]);
function checkedPart(key: string, value: string): string {
  const range = NUMERIC_RANGES.get(key);
  const values = value.split(",");
  if (
    range !== undefined &&
    values.some(
      (part) =>
        !/^-?\d+$/.test(part) ||
        Number(part) < range[0] ||
        Number(part) > range[1] ||
        Number(part) === 0,
    )
  )
    throw invalid();
  if (
    key === "BYDAY" &&
    values.some((part) => {
      const match = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/.exec(part);
      return (
        match === null ||
        (match[1] !== undefined && (Number(match[1]) === 0 || Math.abs(Number(match[1])) > 53))
      );
    })
  )
    throw invalid();
  if (key === "UNTIL") {
    const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/.exec(value);
    if (match === null) throw invalid();
    day(match[1] + "-" + match[2] + "-" + match[3]);
    if (
      match[4] !== undefined &&
      (!conformsToType("time", { t: "str", v: match[4] + ":" + match[5] }) || Number(match[6]) > 59)
    )
      throw invalid();
  }
  return key.startsWith("BY") ? [...new Set(values)].toSorted().join(",") : value;
}

function ruleEntry(entry: string): readonly [string, string] {
  const [key, value, extra] = entry.split("=");
  if (
    key === undefined ||
    !RULE_KEYS.has(key) ||
    value === undefined ||
    value === "" ||
    extra !== undefined
  )
    throw invalid();
  return [key, value];
}
/** One canonical form for local RRULEs and supported Google recurrence lines. */
export function canonicalRule(raw: string): string {
  const body = raw
    .trim()
    .replace(/^RRULE:/i, "")
    .toUpperCase();
  const entries = body.split(";").map(ruleEntry);
  const keys = entries.map(([key]) => key);
  if (new Set(keys).size !== keys.length) throw invalid();
  const freq = entries.find(([key]) => key === "FREQ")?.[1];
  if (freq === undefined || !FREQUENCIES.has(freq)) throw invalid();
  if (keys.includes("COUNT") && keys.includes("UNTIL")) throw invalid();
  if (keys.includes("BYMONTHDAY") && freq === "WEEKLY") throw invalid();
  const byDay = entries.find(([key]) => key === "BYDAY")?.[1];
  if (byDay !== undefined && freq !== "MONTHLY" && freq !== "YEARLY" && /[0-9]/.test(byDay))
    throw invalid();
  if (keys.includes("BYSETPOS") && !keys.some((key) => key.startsWith("BY") && key !== "BYSETPOS"))
    throw invalid();
  const sorted = entries
    .map(([key, value]) => key + "=" + checkedPart(key, value))
    .toSorted()
    .join(";");
  try {
    const rule = RRule.fromString(sorted);
    const until = entries.find(([key]) => key === "UNTIL")?.[1];
    return until !== undefined && /^\d{8}$/.test(until)
      ? rule.toString().replace(/UNTIL=[^;\r\n]+/, "UNTIL=" + until)
      : rule.toString();
  } catch {
    throw invalid();
  }
}

function utcUntil(until: string, zone: string): string {
  const zoned = DateTime.makeZonedUnsafe(formatDay(day(until)) + "T23:59:59", {
    timeZone: zone,
    adjustForTimeZone: true,
  });
  return DateTime.formatIso(zoned)
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d+Z$/, "Z");
}

function recurrence(routine: Routine): readonly string[] {
  if (routine.rrule.trim() === "") {
    if (routine.until !== null) throw invalid();
    return [];
  }
  let body = canonicalRule(routine.rrule).replace(/^RRULE:/, "");
  const rawDay = /(?:^|;)UNTIL=(\d{4})(\d{2})(\d{2})(?:;|$)/.exec(body);
  const until =
    routine.until ?? (rawDay === null ? null : rawDay[1] + "-" + rawDay[2] + "-" + rawDay[3]);
  if (until !== null) {
    body = body
      .split(";")
      .filter((part) => !part.startsWith("UNTIL="))
      .join(";");
    body +=
      ";UNTIL=" +
      (routine.at === null
        ? formatDay(day(until)).replaceAll("-", "")
        : utcUntil(until, routine.zone));
  } else if (routine.at === null && body.includes("UNTIL=")) {
    throw invalid();
  }
  return [canonicalRule(body)];
}

function span(
  routine: Routine,
  on: string,
  at: string | null,
): { start: EventTime; end: EventTime } {
  const date = formatDay(day(on));
  if (at === null) {
    return {
      start: { day: date, at: null, zone: null },
      end: { day: formatDay(addDays(day(date), 1)), at: null, zone: null },
    };
  }
  if (!conformsToType("time", { t: "str", v: at }) || at === "") throw invalid();
  const instant = DateTime.makeZonedUnsafe(date + "T" + at + ":00", {
    timeZone: routine.zone,
    adjustForTimeZone: true,
  });
  const end = DateTime.addDuration(instant, Duration.minutes(routine.duration));
  const parts = DateTime.toParts(end);
  return {
    start: { day: date, at, zone: routine.zone },
    end: {
      day: DateTime.formatIsoDate(end),
      at: String(parts.hour).padStart(2, "0") + ":" + String(parts.minute).padStart(2, "0"),
      zone: routine.zone,
    },
  };
}

function occurrenceSpan(routine: Routine, target: ProjectionTarget) {
  const occurrence = target.kind === "instance" ? target.occurrence : (target.occurrence ?? null);
  if (target.kind === "parent" && occurrence !== null && routine.rrule.trim() !== "")
    throw invalid();
  const moved = occurrence?.state === "moved";
  if (moved && occurrence.movedTo === null) throw invalid();
  const on = moved ? occurrence.movedTo : target.kind === "instance" ? target.on : routine.starts;
  const at = moved ? (occurrence.at ?? routine.at) : routine.at;
  if (on === null) throw invalid();
  if (occurrence !== null) day(occurrence.on);
  return { occurrence, on, at };
}

/** Pure projection. Sparse occurrences preserve identity through their original day. */
export function project(
  routine: Routine,
  backlink: string,
  generation: number,
  target: ProjectionTarget = { kind: "parent" },
): EventFields {
  if (
    routine.repeatsFrom !== "schedule" ||
    !Number.isSafeInteger(routine.duration) ||
    routine.duration <= 0
  )
    throw invalid();
  // Validate the zone even for all-day events: it owns occurrence-day identity.
  DateTime.zoneMakeNamedUnsafe(routine.zone);
  const { occurrence, on, at } = occurrenceSpan(routine, target);
  const times = span(routine, on, at);
  return {
    title: routine.title,
    ...times,
    recurrence: target.kind === "parent" ? recurrence(routine) : [],
    status: occurrence?.state === "skipped" ? "cancelled" : "confirmed",
    nodeId: routine.id,
    unit:
      target.kind === "instance" ? target.on : routine.rrule.trim() === "" ? "one-off" : "series",
    generation,
    backlink,
    done: occurrence?.state === "done",
  };
}

const hashProjection = Effect.fnUntraced(function* (value: unknown) {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  return new Uint8Array(yield* Effect.promise(() => crypto.subtle.digest("SHA-256", bytes)));
});
export const projectionFingerprint = Effect.fn("routines.projectionFingerprint")(function* (
  value: unknown,
) {
  const bytes = yield* hashProjection(value);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
});
export const eventId = Effect.fn("routines.eventId")(function* (
  calendarNode: string,
  routine: string,
  unit: string,
  generation: number,
) {
  const hash = yield* hashProjection([calendarNode, routine, unit, generation]);
  const alphabet = "0123456789abcdefghijklmnopqrstuv";
  let bits = 0;
  let accumulator = 0;
  let encoded = "";
  for (const byte of hash) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += alphabet[(accumulator >>> bits) & 31];
    }
  }
  return "kb" + encoded.slice(0, 30);
});

export function endSeries(fields: EventFields, yesterday: string): EventFields {
  const until =
    fields.start.at === null
      ? formatDay(day(yesterday)).replaceAll("-", "")
      : utcUntil(yesterday, fields.start.zone ?? "Asia/Ho_Chi_Minh");
  const body = fields.recurrence[0]?.replace(/^RRULE:/, "") ?? "";
  const existing = /(?:^|;)UNTIL=([^;]+)/.exec(body)?.[1];
  if (existing !== undefined && existing <= until) return fields;
  if (body.includes("COUNT=")) {
    const rule = RRule.fromString(body);
    const floating = DateTime.toDateUtc(
      DateTime.makeUnsafe(fields.start.day + "T" + (fields.start.at ?? "00:00") + ":00Z"),
    );
    const bounded = new RRule({ ...rule.origOptions, dtstart: floating });
    if (
      bounded.after(DateTime.toDateUtc(DateTime.makeUnsafe(yesterday + "T23:59:59Z")), false) ===
      null
    )
      return fields;
  }
  const retained = body
    .split(";")
    .filter((part) => !part.startsWith("UNTIL=") && !part.startsWith("COUNT="));
  return { ...fields, recurrence: [canonicalRule(retained.join(";") + ";UNTIL=" + until)] };
}
