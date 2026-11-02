import { DateTime, Option, Schema } from "effect";
import { parseDay } from "@kb/model";
import {
  normalizedRecurrence,
  SyncError,
  type EventFields,
  type EventTime,
  type RemoteEvent,
} from "@kb/routines";

export const GoogleTime = Schema.Struct({
  date: Schema.optionalKey(Schema.String),
  dateTime: Schema.optionalKey(Schema.String),
  timeZone: Schema.optionalKey(Schema.String),
});
export const GoogleEvent = Schema.Struct({
  id: Schema.String,
  etag: Schema.optionalKey(Schema.String),
  htmlLink: Schema.optionalKey(Schema.String),
  summary: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.Literals(["confirmed", "cancelled", "tentative"])),
  start: Schema.optionalKey(GoogleTime),
  end: Schema.optionalKey(GoogleTime),
  recurrence: Schema.optionalKey(Schema.Array(Schema.String)),
  recurringEventId: Schema.optionalKey(Schema.String),
  originalStartTime: Schema.optionalKey(GoogleTime),
  description: Schema.optionalKey(Schema.String),
  colorId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  source: Schema.optionalKey(
    Schema.Struct({
      url: Schema.optionalKey(Schema.String),
      title: Schema.optionalKey(Schema.String),
    }),
  ),
  reminders: Schema.optionalKey(
    Schema.Struct({
      useDefault: Schema.Boolean,
      overrides: Schema.optionalKey(Schema.Array(Schema.Unknown)),
    }),
  ),
  extendedProperties: Schema.optionalKey(
    Schema.Struct({
      private: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
    }),
  ),
});
export type GoogleEvent = typeof GoogleEvent.Type;
const invalid = () => new SyncError({ status: 502, code: "invalid_response" });

export function decodeTime(time: typeof GoogleTime.Type, fallback = "Etc/UTC"): EventTime {
  if (time.date !== undefined) {
    if (parseDay(time.date) === null) throw invalid();
    return { day: time.date, at: null, zone: null };
  }
  if (time.dateTime === undefined) throw invalid();
  const offset = /(Z|[+-]\d{2}:\d{2})$/.exec(time.dateTime)?.[1];
  const zone = time.timeZone ?? (offset === "Z" ? "Etc/UTC" : offset) ?? fallback;
  const parsed = DateTime.makeZonedUnsafe(time.dateTime, {
    timeZone: zone,
    adjustForTimeZone: offset === undefined,
  });
  const parts = DateTime.toParts(parsed);
  const clock = String(parts.hour).padStart(2, "0") + ":" + String(parts.minute).padStart(2, "0");
  const seconds =
    parts.second === 0 && parts.millisecond === 0
      ? ""
      : ":" + String(parts.second).padStart(2, "0");
  const millis = parts.millisecond === 0 ? "" : "." + String(parts.millisecond).padStart(3, "0");
  return { day: DateTime.formatIsoDate(parsed), at: clock + seconds + millis, zone };
}
export function encodeTime(time: EventTime) {
  if (time.at === null) return { date: time.day };
  const local = time.day + "T" + time.at + (time.at.length === 5 ? ":00" : "");
  const zone = DateTime.zoneFromString(time.zone ?? "Etc/UTC");
  if (Option.isNone(zone)) throw invalid();
  return DateTime.isTimeZoneNamed(zone.value)
    ? { dateTime: local, timeZone: time.zone ?? "Etc/UTC" }
    : { dateTime: local + DateTime.zoneToString(zone.value) };
}
export function encodeEvent(fields: EventFields, runner: string) {
  return {
    summary: (fields.done ? "✅ " : "") + fields.title,
    start: encodeTime(fields.start),
    end: encodeTime(fields.end),
    recurrence: [...fields.recurrence],
    status: fields.status,
    description: "kb: " + fields.backlink,
    source: { title: "kb", url: fields.backlink },
    colorId: fields.done ? "8" : null,
    reminders: fields.done ? { useDefault: false, overrides: [] } : { useDefault: true },
    extendedProperties: {
      private: {
        kbNode: fields.nodeId,
        kbUnit: fields.unit,
        kbGen: String(fields.generation),
        kbDone: fields.done ? "1" : "0",
        kbRunner: runner,
      },
    },
  };
}
function validGeneration(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
function eventFields(raw: GoogleEvent): EventFields | null {
  const metadata = raw.extendedProperties?.private ?? {};
  const start = raw.start === undefined ? null : decodeTime(raw.start);
  const end = raw.end === undefined ? null : decodeTime(raw.end, start?.zone ?? "Etc/UTC");
  if (metadata.kbNode === undefined || start === null || end === null) return null;
  const done = metadata.kbDone === "1";
  const summary = raw.summary ?? "";
  const generation = Number(metadata.kbGen ?? 0);
  return {
    title: done && summary.startsWith("✅ ") ? summary.slice(2) : summary,
    start,
    end,
    recurrence: normalizedRecurrence(raw.recurrence ?? []),
    status: raw.status ?? "confirmed",
    nodeId: metadata.kbNode,
    unit: metadata.kbUnit ?? "series",
    generation: validGeneration(generation),
    backlink: raw.source?.url ?? "",
    done,
  };
}
function ownedDrift(raw: GoogleEvent, fields: EventFields | null): boolean {
  if (fields === null) return false;
  if (raw.description !== "kb: " + fields.backlink || raw.source?.title !== "kb") return true;
  return fields.done
    ? !(raw.summary ?? "").startsWith("✅ ") ||
        raw.colorId !== "8" ||
        raw.reminders?.useDefault !== false ||
        (raw.reminders.overrides?.length ?? 0) !== 0
    : (raw.colorId !== undefined && raw.colorId !== null) || raw.reminders?.useDefault !== true;
}
export function decodeEvent(raw: GoogleEvent): RemoteEvent {
  const fields = eventFields(raw);
  return {
    id: raw.id,
    etag: raw.etag ?? "",
    url: raw.htmlLink ?? "",
    fields,
    deleted: raw.status === "cancelled",
    runner: raw.extendedProperties?.private?.kbRunner ?? null,
    seriesId: raw.recurringEventId ?? null,
    originalStart:
      raw.originalStartTime === undefined
        ? null
        : decodeTime(raw.originalStartTime, fields?.start.zone ?? "Etc/UTC"),
    ownedDrift: ownedDrift(raw, fields),
  };
}
