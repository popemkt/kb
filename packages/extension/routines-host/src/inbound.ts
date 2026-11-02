import { Random, Result, Clock, DateTime, Effect, Option, Schema } from "effect";
import { canonicalJson } from "@kb/model";
import {
  eventId,
  pendingApplied,
  pollEvery,
  retryDelay,
  RemoteEvent,
  SyncError,
  type UnitRecord,
} from "@kb/routines";
import type { EngineContext } from "./context.ts";
import { reportFailure } from "./failures.ts";
import type { CalendarSession } from "./session.ts";

const Scan = Schema.Struct({
  token: Schema.NullOr(Schema.String),
  page: Schema.NullOr(Schema.String),
  full: Schema.Boolean,
  seen: Schema.Array(Schema.String),
  pending: Schema.Array(RemoteEvent),
});
function discoveredRecord(
  event: RemoteEvent,
  fields: NonNullable<RemoteEvent["fields"]>,
  details: { calendar: string; at: number; revision: number },
): UnitRecord {
  const { calendar, at, revision } = details;
  const parent = event.seriesId === null;
  return {
    key: event.id,
    routineId: fields.nodeId,
    occurrenceId: null,
    day: parent ? null : (event.originalStart?.day ?? null),
    calendar,
    kind: parent ? (fields.unit === "series" ? "series" : "one-off") : "exception",
    generation: fields.generation,
    base: fields,
    etag: event.etag,
    state: event.deleted ? "deleted" : "dirty",
    dirtySince: at,
    lastTouch: at,
    nextAttemptAt: at,
    attempts: 0,
    lastError: null,
    conflict: null,
    pending: null,
    localRev: revision,
    source: "",
    inputs: [],
    version: 0,
  };
}
export class Inbound {
  readonly context: EngineContext;
  readonly next = new Map<string, number>();
  private readonly failures = new Map<string, number>();
  constructor(context: EngineContext) {
    this.context = context;
  }
  readonly managed = Effect.fn("routines.inbound.managed")(function* (
    this: Inbound,
    calendar: string,
    event: RemoteEvent,
  ) {
    const fields = event.fields;
    if (fields === null) return false;
    if (event.seriesId === null)
      return (yield* eventId(calendar, fields.nodeId, "series", fields.generation)) === event.id;
    const series = yield* this.context.options.ledger.unit.get(event.seriesId);
    return series !== null && series.calendar === calendar && series.routineId === fields.nodeId;
  });
  readonly discover = Effect.fn("routines.inbound.discover")(function* (
    this: Inbound,
    session: CalendarSession,
    event: RemoteEvent,
  ) {
    const context = this.context;
    const calendar = session.binding.calendar.id;
    let unit = yield* context.options.ledger.unit.get(event.id);
    if (unit !== null && unit.calendar !== calendar) return null;
    if (unit === null && event.fields !== null && event.fields.nodeId !== "") {
      const fields = event.fields;
      const at = yield* Clock.currentTimeMillis;
      const parent =
        event.seriesId === null && (fields.unit === "series" || fields.unit === "one-off");
      if (!parent && event.originalStart === null) return null;
      if (!(yield* this.managed(calendar, event))) return null;
      const fresh = discoveredRecord(event, fields, { calendar, at, revision: context.revision });
      yield* context.options.ledger.unit.put(fresh, 0);
      unit = yield* context.options.ledger.unit.get(event.id);
    }
    if (unit === null && event.seriesId !== null && event.originalStart !== null) {
      const parent = yield* context.options.ledger.unit.get(event.seriesId);
      if (parent === null || parent.calendar !== calendar) return null;
      const fresh: UnitRecord = {
        ...parent,
        key: event.id,
        kind: "exception",
        day: event.originalStart.day,
        base: event.fields,
        etag: event.etag,
        version: 0,
        source: "",
        state: event.deleted ? "deleted" : "dirty",
        pending: null,
      };
      yield* context.options.ledger.unit.put(fresh, 0);
      unit = yield* context.options.ledger.unit.get(event.id);
    }
    return unit;
  });
  readonly observe = Effect.fn("routines.inbound.observe")(function* (
    this: Inbound,
    session: CalendarSession,
    event: RemoteEvent,
  ) {
    const context = this.context;
    const unit = yield* this.discover(session, event);
    if (unit === null || unit.etag === event.etag || unit.state === "ended") return;
    if (event.runner !== null && event.runner !== context.options.runner)
      yield* context.options.ledger.log.append({
        at: yield* Clock.currentTimeMillis,
        key: unit.key,
        code: "another_runner",
      });
    const proven = pendingApplied(unit, event);
    yield* context.queue.mutate(unit.key, (current) => ({
      ...current,
      etag: event.etag,
      state: "dirty",
      nextAttemptAt: 0,
      base: proven ? (current.pending?.base ?? current.base) : current.base,
      pending: proven ? null : current.pending,
    }));
  });
  readonly finishScan = Effect.fn("routines.inbound.finishScan")(function* (
    this: Inbound,
    scan: {
      calendar: string;
      token: string;
      state: typeof Scan.Type;
      seen: readonly string[];
      day: string;
    },
  ) {
    const context = this.context;
    const { calendar, token, state, seen, day } = scan;
    if (state.full)
      for (const unit of yield* context.options.ledger.unit.all(calendar)) {
        if (
          unit.base !== null &&
          unit.state !== "ended" &&
          !seen.includes(unit.key) &&
          unit.pending === null
        ) {
          yield* context.queue.mutate(unit.key, (current) => ({
            ...current,
            state: "deleted",
            conflict: { base: current.base, local: null, remote: null },
          }));
        }
      }
    yield* context.options.ledger.cursor.set("token:" + calendar, token);
    yield* context.options.ledger.cursor.set("scan:" + calendar, "");
    yield* context.options.ledger.cursor.set("initialized:" + calendar, "yes");
    if (state.full) yield* context.options.ledger.cursor.set("full:" + calendar, day);
    const roots = (yield* context.options.ledger.unit.all(calendar)).filter(
      (unit) => unit.kind !== "exception",
    );
    for (const unit of roots)
      if (
        roots.some(
          (other) => other.routineId === unit.routineId && other.generation > unit.generation,
        )
      ) {
        yield* context.queue.mutate(unit.key, (current) => ({
          ...current,
          state: "ended",
          pending: null,
        }));
      }
  });
  readonly reconnected = Effect.fn("routines.inbound.reconnected")(function* (
    this: Inbound,
    calendar: string,
    at: number,
  ) {
    const context = this.context;
    for (const unit of yield* context.options.ledger.unit.all(calendar))
      if (
        unit.state === "failed" &&
        (unit.lastError?.status === 0 || (unit.lastError !== null && unit.lastError.status >= 500))
      ) {
        yield* context.queue.mutate(unit.key, (current) => ({
          ...current,
          state: "dirty",
          attempts: 0,
          nextAttemptAt: at,
        }));
      }
  });
  private readonly scanState = Effect.fn("routines.inbound.scanState")(function* (
    this: Inbound,
    calendar: string,
    at: number,
    zone: string,
  ) {
    const context = this.context;
    const saved = yield* context.options.ledger.cursor.get("scan:" + calendar);
    const zoned = DateTime.makeZonedUnsafe(at, { timeZone: zone });
    const day = DateTime.formatIsoDate(
      DateTime.toParts(zoned).hour < 4 ? DateTime.subtract(zoned, { days: 1 }) : zoned,
    );
    const daily = (yield* context.options.ledger.cursor.get("full:" + calendar)) !== day;
    const token = yield* context.options.ledger.cursor.get("token:" + calendar);
    const state =
      saved === null || saved === ""
        ? {
            token: daily ? null : token,
            page: null,
            full: daily || token === null,
            seen: [],
            pending: [],
          }
        : yield* Schema.decodeEffect(Schema.fromJsonString(Scan))(saved).pipe(
            Effect.mapError(() => new SyncError({ status: 500, code: "invalid_cursor" })),
          );
    return { state, day };
  });
  readonly pollSession = Effect.fn("routines.inbound.pollSession")(function* (
    this: Inbound,
    session: CalendarSession,
    force: boolean,
  ) {
    const context = this.context;
    const calendar = session.binding.calendar.id;
    const at = yield* Clock.currentTimeMillis;
    if (!force && (this.next.get(calendar) ?? 0) > at) return undefined;
    const { state, day } = yield* this.scanState(calendar, at, session.binding.calendar.zone);
    const result = yield* Effect.result(
      session.call(1, () =>
        session.client.list(session.binding.calendar.calendarId, state.token, state.page),
      ),
    );
    if (Result.isFailure(result)) {
      if (result.failure.status === 410 && state.token !== null) {
        yield* context.options.ledger.cursor.set("scan:" + calendar, "");
        yield* context.options.ledger.cursor.set("token:" + calendar, "");
        yield* context.options.ledger.cursor.set("full:" + calendar, "");
        this.next.set(calendar, at);
      } else {
        yield* reportFailure(context, session, result.failure);
        const attempt = (this.failures.get(calendar) ?? 0) + 1;
        this.failures.set(calendar, attempt);
        this.next.set(
          calendar,
          at +
            retryDelay(
              attempt,
              yield* Random.next,
              result.failure.code === "quota" ? "quota" : "transport",
              result.failure.retryAfter,
            ),
        );
      }
      return undefined;
    }
    if (Option.isNone(result.success)) return undefined;
    const page = result.success.value;
    this.failures.delete(calendar);
    if (!(yield* session.owns())) return undefined;
    yield* this.reconnected(calendar, at);
    for (const event of page.events.filter((entry) => entry.seriesId === null))
      yield* this.observe(session, event);
    const pending = [...state.pending, ...page.events.filter((entry) => entry.seriesId !== null)];
    const seen = [...new Set([...state.seen, ...page.events.map((event) => event.id)])];
    if (page.nextPage !== null) {
      yield* context.options.ledger.cursor.set(
        "scan:" + calendar,
        canonicalJson({ ...state, page: page.nextPage, seen, pending }),
      );
      this.next.set(calendar, at);
      return undefined;
    }
    if (page.nextToken === null)
      return yield* new SyncError({ status: 502, code: "missing_sync_token" });
    for (const event of pending) yield* this.observe(session, event);
    yield* this.finishScan({ calendar, token: page.nextToken, state, seen, day });
    yield* context.refresh({
      kind: state.full ? "reconcile" : "startup",
      at,
      revision: context.revision,
    });
    this.next.set(calendar, at + pollEvery(yield* context.options.host.attention(context.nodes)));
    return undefined;
  });
  readonly poll = Effect.fn("routines.inbound.poll")(function* (this: Inbound, force = false) {
    for (const { session } of this.context.sessions.values())
      yield* this.pollSession(session, force);
  });
}
