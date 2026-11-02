import { DateTime } from "effect";
import { canonicalJson } from "@kb/model";
import { endSeries, mergeFields } from "./projection.ts";
import {
  SHARED_EVENT_FIELDS as SHARED,
  type EventFields,
  type RemoteEvent,
  type SyncConflict,
  type UnitRecord,
} from "./model.ts";
import type { CalendarMutation } from "./ports.ts";

export interface UnitPlan {
  readonly mutation: CalendarMutation | null;
  readonly base: EventFields | null;
  readonly outcome: "synced" | "ended" | "deleted" | "conflict";
  readonly conflict: SyncConflict | null;
  readonly destructive: boolean;
}
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

/** A pending response may have been lost after the server committed it. */
export function pendingApplied(unit: UnitRecord, remote: RemoteEvent | null): boolean {
  const pending = unit.pending;
  if (pending === null) return false;
  if (pending.fields === null) return remote === null || remote.deleted;
  return (
    remote !== null &&
    (equal(pending.fields, remote.fields) ||
      (pending.fields.status === "cancelled" && remote.deleted))
  );
}
function future(fields: EventFields, now: number, yesterday: string): boolean {
  if (fields.start.at === null)
    return (
      fields.start.day >
      DateTime.formatIsoDate(
        DateTime.add(DateTime.makeUnsafe(yesterday + "T00:00:00Z"), { days: 1 }),
      )
    );
  const at = fields.start.at;
  return (
    DateTime.toEpochMillis(
      DateTime.makeZonedUnsafe(fields.start.day + "T" + at + (at.length === 5 ? ":00" : ""), {
        timeZone: fields.start.zone ?? "Etc/UTC",
        adjustForTimeZone: true,
      }),
    ) > now
  );
}
function blocked(
  base: EventFields | null,
  local: EventFields | null,
  remote: EventFields | null,
): UnitPlan {
  return {
    mutation: null,
    base,
    outcome: "conflict",
    conflict: { base, local, remote },
    destructive: false,
  };
}
function updatePlan(
  unit: UnitRecord,
  base: EventFields,
  local: EventFields,
  remote: RemoteEvent,
  ending: boolean,
): UnitPlan {
  const current = remote.fields;
  if (current === null) return blocked(base, local, null);
  const merged = mergeFields(base, local, current);
  const conflict = merged.conflicts.length === 0 ? null : { base, local, remote: current };
  const acceptedBase = { ...merged.fields };
  for (const key of merged.conflicts) Object.assign(acceptedBase, { [key]: base[key] });
  const mutation =
    equal(merged.fields, current) && !remote.ownedDrift
      ? null
      : {
          kind: "update" as const,
          id: unit.key,
          etag: remote.etag,
          fields: merged.fields,
        };
  return {
    mutation,
    base: acceptedBase,
    outcome: conflict === null ? (ending ? "ended" : "synced") : "conflict",
    conflict,
    destructive: ending && mutation !== null,
  };
}

function deletionPlan(
  unit: UnitRecord,
  base: EventFields | null,
  remote: RemoteEvent | null,
  now: number,
  yesterday: string,
): UnitPlan {
  if (remote === null || remote.deleted)
    return { mutation: null, base, outcome: "ended", conflict: null, destructive: false };
  if (remote.fields === null) return blocked(base, null, null);
  const agreed = base ?? remote.fields;
  if (unit.kind === "exception")
    return { mutation: null, base, outcome: "ended", conflict: null, destructive: false };
  if (unit.kind === "series") {
    return updatePlan(unit, agreed, endSeries(remote.fields, yesterday), remote, true);
  }
  if (!future(remote.fields, now, yesterday))
    return {
      mutation: null,
      base: remote.fields,
      outcome: "ended",
      conflict: null,
      destructive: false,
    };
  if (SHARED.some((key) => !equal(agreed[key], remote.fields?.[key])))
    return blocked(agreed, null, remote.fields);
  return {
    mutation: { kind: "remove", id: unit.key, etag: remote.etag },
    base: null,
    outcome: "ended",
    conflict: null,
    destructive: true,
  };
}

function cancelledPlan(
  unit: UnitRecord,
  base: EventFields | null,
  local: EventFields,
  remote: RemoteEvent,
): UnitPlan {
  if (local.status === "cancelled")
    return { mutation: null, base: local, outcome: "synced", conflict: null, destructive: false };
  if (unit.kind !== "series" && base?.status === "cancelled")
    return updatePlan(unit, base, local, { ...remote, fields: remote.fields ?? base }, false);
  return {
    mutation: null,
    base,
    outcome: "deleted",
    conflict: { base, local, remote: remote.fields },
    destructive: false,
  };
}

/** One owner for projection, deletion and P1 three-way conflict policy. */
export function planUnit(
  unit: UnitRecord,
  local: EventFields | null,
  remote: RemoteEvent | null,
  now: number,
  yesterday: string,
): UnitPlan {
  const base = pendingApplied(unit, remote) ? (unit.pending?.base ?? null) : unit.base;
  if (local !== null && unit.state === "deleted" && local.status !== "cancelled") {
    return {
      mutation: null,
      base,
      outcome: "deleted",
      conflict: unit.conflict,
      destructive: false,
    };
  }
  if (local === null) return deletionPlan(unit, base, remote, now, yesterday);
  if (remote === null) {
    if (local.status === "cancelled")
      return { mutation: null, base: local, outcome: "synced", conflict: null, destructive: false };
    if (
      base !== null &&
      !(unit.kind === "one-off" && unit.etag === null && base.status === "cancelled")
    )
      return {
        mutation: null,
        base,
        outcome: "deleted",
        conflict: { base, local, remote: null },
        destructive: false,
      };
    return {
      mutation: { kind: "insert", id: unit.key, fields: local },
      base: local,
      outcome: "synced",
      conflict: null,
      destructive: false,
    };
  }
  if (remote.deleted) return cancelledPlan(unit, base, local, remote);
  if (
    remote.fields === null ||
    remote.fields.nodeId !== unit.routineId ||
    remote.fields.generation !== unit.generation
  )
    return blocked(base, local, remote.fields);
  return updatePlan(unit, base ?? remote.fields, local, remote, false);
}
