import { DateTime, Option, Schema } from "effect";
import { SyncError, type EventFields, type EventTime, type RemoteEvent } from "@kb/routines";

const invalid = () => new SyncError({ status: 502, code: "invalid_response" });

export function encodeTime(time: EventTime) {
  if (time.at === null) return { date: time.day };
  const local = time.day + "T" + time.at + (time.at.length === 5 ? ":00" : "");
  const zone = DateTime.zoneFromString(time.zone ?? "Etc/UTC");
  if (Option.isNone(zone)) throw invalid();
  return DateTime.isTimeZoneNamed(zone.value)
    ? { dateTime: local, timeZone: time.zone ?? "Etc/UTC" }
    : { dateTime: local + DateTime.zoneToString(zone.value) };
}
/** The event kb puts: its fields in Google's shape, with what kb stores beside them (`kbSent`). */
export function encodeEvent(fields: EventFields, runner: string, digest: string) {
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
        kbSent: digest,
      },
    },
  };
}

const GoogleTime = Schema.Struct({
  date: Schema.optionalKey(Schema.String),
  dateTime: Schema.optionalKey(Schema.String),
  timeZone: Schema.optionalKey(Schema.String),
});
/** An event as `events.list` returns it: only what kb reads back. */
export const GoogleEvent = Schema.Struct({
  id: Schema.String,
  htmlLink: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.String),
  summary: Schema.optionalKey(Schema.String),
  start: Schema.optionalKey(GoogleTime),
  end: Schema.optionalKey(GoogleTime),
  recurrence: Schema.optionalKey(Schema.Array(Schema.String)),
  recurringEventId: Schema.optionalKey(Schema.String),
  originalStartTime: Schema.optionalKey(GoogleTime),
  source: Schema.optionalKey(Schema.Struct({ url: Schema.optionalKey(Schema.String) })),
  extendedProperties: Schema.optionalKey(
    Schema.Struct({
      private: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
    }),
  ),
});
export type GoogleEvent = typeof GoogleEvent.Type;

/**
 * A Google time as kb's: a date is all-day; a date-time is its wall clock in
 * its own zone, the zone it names, or else the instant's in UTC.
 */
function decodeTime(time: typeof GoogleTime.Type): EventTime {
  if (time.date !== undefined) return { day: time.date, at: null, zone: null };
  if (time.dateTime === undefined) throw invalid();
  const zone = time.timeZone ?? "Etc/UTC";
  const offset = /(?:Z|[+-]\d\d:\d\d)$/.test(time.dateTime);
  const instant = offset
    ? DateTime.makeZonedUnsafe(DateTime.makeUnsafe(time.dateTime), { timeZone: zone })
    : DateTime.makeZonedUnsafe(time.dateTime, { timeZone: zone, adjustForTimeZone: true });
  const parts = DateTime.toParts(instant);
  return {
    day: DateTime.formatIsoDate(instant),
    at: String(parts.hour).padStart(2, "0") + ":" + String(parts.minute).padStart(2, "0"),
    zone,
  };
}

/** What kb put on an event of its own, read back; null for one kb did not write. */
function decodeFields(event: GoogleEvent): EventFields | null {
  const own = event.extendedProperties?.private;
  if (own?.kbNode === undefined || own.kbNode === "" || event.start === undefined) return null;
  if (event.end === undefined) return null;
  const done = own.kbDone === "1";
  const summary = event.summary ?? "";
  const status = event.status;
  return {
    title: done && summary.startsWith("✅ ") ? summary.slice("✅ ".length) : summary,
    start: decodeTime(event.start),
    end: decodeTime(event.end),
    recurrence: [...(event.recurrence ?? [])],
    status: status === "cancelled" || status === "tentative" ? status : "confirmed",
    nodeId: own.kbNode,
    unit: own.kbUnit ?? "",
    generation: Number(own.kbGen ?? "0"),
    backlink: event.source?.url ?? "",
    done,
  };
}

/** One listed event as the port's {@link RemoteEvent}: a cancelled one keeps only its ids. */
export function decodeEvent(event: GoogleEvent): RemoteEvent {
  const cancelled = event.status === "cancelled";
  const exception =
    event.recurringEventId === undefined || event.originalStartTime === undefined
      ? null
      : { series: event.recurringEventId, original: decodeTime(event.originalStartTime) };
  return {
    id: event.id,
    url: event.htmlLink ?? "",
    exception,
    cancelled,
    fields: cancelled ? null : decodeFields(event),
    digest: cancelled ? null : (event.extendedProperties?.private?.kbSent ?? null),
  };
}
