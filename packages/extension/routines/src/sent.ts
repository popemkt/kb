import { DateTime, Effect } from "effect";
import type { EventFields, EventTime, RemoteEvent } from "./model.ts";
import { projectionFingerprint } from "./projection.ts";

/**
 * The schema of the fields a digest covers (docs/research/2026-11-02-kb-routines-gcal.md
 * → What Google holds is compared by digest). A change that adds a field to
 * `EventFields` adds a schema, and a digest is compared under its own.
 */
const SENT_SCHEMA = "1";

/** What kb stores with an event it puts (`kbSent`): the schema, then the fields' SHA-256. */
export const sentDigest = Effect.fn("routines.sentDigest")(function* (fields: EventFields) {
  return SENT_SCHEMA + ":" + (yield* projectionFingerprint(fields));
});

/**
 * Whether Google holds the write of `fields`, whose digest is `digest`: an
 * event with that digest, or a cancelled event for a cancelled write, since
 * Google keeps nothing else of a cancelled event. One with no digest, from
 * before kb stored one or not kb's, holds no write.
 */
export function holds(
  remote: RemoteEvent | undefined,
  fields: EventFields,
  digest: string,
): boolean {
  if (remote === undefined) return false;
  if (remote.cancelled) return fields.status === "cancelled";
  return remote.digest === digest;
}

/** The day a start falls on in `zone`: its own day when all-day, else its instant's local day there. */
export function startDay(time: EventTime, zone: string): string {
  if (time.at === null) return time.day;
  const start = DateTime.makeZonedUnsafe(time.day + "T" + time.at, {
    timeZone: time.zone ?? zone,
    adjustForTimeZone: true,
  });
  return DateTime.formatIsoDate(DateTime.setZoneNamedUnsafe(start, zone));
}

/**
 * Whether a listed event is kb's: one whose private `kbNode` names a node, so
 * that the adapter decoded kb's fields from it. An exception is kb's when its
 * series is. Nothing else in kb's calendar is compared, rewritten or ended.
 */
export function owned(remote: RemoteEvent): boolean {
  return remote.fields !== null && remote.fields.nodeId !== "";
}
