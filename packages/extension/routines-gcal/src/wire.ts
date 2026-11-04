import { DateTime, Option } from "effect";
import { SyncError, type EventFields, type EventTime } from "@kb/routines";

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
