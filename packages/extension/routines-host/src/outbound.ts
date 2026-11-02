import { Result, Clock, DateTime, Effect, Option } from "effect";
import { addDays, canonicalJson, formatDay, parseDay } from "@kb/model";
import {
  planUnit,
  SyncError,
  type RemoteEvent,
  type UnitPlan,
  type UnitRecord,
} from "@kb/routines";
import type { EngineContext } from "./context.ts";
import { reportFailure } from "./failures.ts";
import { localProjection, queueOccurrences } from "./occurrences.ts";
import type { CalendarSession } from "./session.ts";

interface Ready {
  readonly unit: UnitRecord;
  readonly plan: UnitPlan;
  readonly remote: RemoteEvent | null;
}
export class Outbound {
  readonly context: EngineContext;
  constructor(context: EngineContext) {
    this.context = context;
  }
  readonly prepare = Effect.fn("routines.outbound.prepare")(function* (
    this: Outbound,
    session: CalendarSession,
    unit: UnitRecord,
  ) {
    const context = this.context;
    const local = yield* Effect.try({
      try: () => localProjection(context, unit, session.binding.calendar.zone),
      catch: () => new SyncError({ status: 400, code: "invalid_rule" }),
    });
    const fetched = yield* session.call(1, () =>
      session.client.get(session.binding.calendar.calendarId, unit.key).pipe(
        Effect.catchIf(
          (error) => error.status === 404 || error.status === 410,
          () => Effect.succeed(null),
        ),
      ),
    );
    if (Option.isNone(fetched)) return null;
    const current = yield* context.options.ledger.unit.get(unit.key);
    if (current === null || current.localRev !== unit.localRev || current.source !== unit.source)
      return null;
    const at = yield* Clock.currentTimeMillis;
    const today = parseDay(
      DateTime.formatIsoDate(
        DateTime.makeZonedUnsafe(at, { timeZone: session.binding.calendar.zone }),
      ),
    );
    if (today === null) return yield* new SyncError({ status: 400, code: "invalid_day" });
    return {
      unit: current,
      remote: fetched.value,
      plan: planUnit(current, local, fetched.value, at, formatDay(addDays(today, -1))),
    };
  });
  readonly acknowledge = Effect.fn("routines.outbound.acknowledge")(function* (
    this: Outbound,
    ready: Ready,
    remote: RemoteEvent | null,
    journal: string | null,
  ) {
    const context = this.context;
    const changed = yield* context.queue.mutate(ready.unit.key, (current) => {
      if (journal !== null && current.pending?.id !== journal) return current;
      const newer = current.localRev > ready.unit.localRev || current.source !== ready.unit.source;
      const observedNewerHead = current.etag !== ready.unit.etag && current.etag !== remote?.etag;
      return {
        ...current,
        base: observedNewerHead ? current.base : ready.plan.base,
        etag: observedNewerHead ? current.etag : (remote?.etag ?? null),
        state: newer || observedNewerHead ? "dirty" : ready.plan.outcome,
        pending: null,
        attempts: 0,
        conflict: ready.plan.conflict,
        lastError: null,
      };
    });
    if (changed === null) return;
    if (journal !== null) yield* context.options.ledger.cursor.set("release:" + changed.key, "");
    if (changed.state === "ended" && changed.kind !== "exception") {
      for (const child of yield* context.options.ledger.unit.byRoutine(changed.routineId))
        if (
          child.kind === "exception" &&
          child.generation === changed.generation &&
          child.calendar === changed.calendar
        ) {
          yield* context.queue.mutate(child.key, (record) => ({
            ...record,
            state: "ended",
            pending: null,
          }));
        }
    }
    if (remote !== null && remote.url !== "" && changed.kind !== "exception")
      yield* context.options.host.link(changed.routineId, remote.url);
    if (changed.state === "synced") {
      const session = this.sessionFor(changed);
      const complete = yield* queueOccurrences(context, session, changed).pipe(
        Effect.catch((error) =>
          reportFailure(context, session, error, changed).pipe(Effect.as(true)),
        ),
      );
      if (!complete)
        yield* context.queue.mutate(changed.key, (unit) => ({ ...unit, state: "dirty" }));
    }
  });
  sessionFor(unit: UnitRecord): CalendarSession {
    const session = this.context.sessions.get(unit.calendar)?.session;
    if (session === undefined) throw new SyncError({ status: 409, code: "binding_changed" });
    return session;
  }
  readonly send = Effect.fn("routines.outbound.send")(function* (
    this: Outbound,
    session: CalendarSession,
    ready: readonly Ready[],
  ) {
    const context = this.context;
    const called = yield* session
      .call(Math.min(50, ready.length), (admitted) =>
        Effect.gen(function* () {
          const selected = ready.slice(0, admitted);
          const prepared: { ready: Ready; journal: string }[] = [];
          for (const item of selected) {
            const journal = crypto.randomUUID();
            const updated = yield* context.queue.mutate(item.unit.key, (current) =>
              current.localRev !== item.unit.localRev || current.source !== item.unit.source
                ? current
                : {
                    ...current,
                    state: "pushing",
                    pending: {
                      id: journal,
                      fields:
                        item.plan.mutation?.kind === "remove"
                          ? null
                          : (item.plan.mutation?.fields ?? null),
                      base: item.plan.base,
                      localRev: current.localRev,
                      source: current.source,
                      outcome: item.plan.outcome === "deleted" ? "conflict" : item.plan.outcome,
                      conflict: item.plan.conflict,
                    },
                  },
            );
            if (updated?.pending?.id === journal) prepared.push({ ready: item, journal });
          }
          const mutations = prepared.flatMap((item) =>
            item.ready.plan.mutation === null ? [] : [item.ready.plan.mutation],
          );
          const outcomes = yield* session.client.write(
            session.binding.calendar.calendarId,
            mutations,
          );
          return { prepared, outcomes };
        }),
      )
      .pipe(
        Effect.catch((error) =>
          Effect.forEach(ready, (item) => reportFailure(context, session, error, item.unit), {
            discard: true,
          }).pipe(Effect.as(Option.none())),
        ),
      );
    if (Option.isNone(called) || !(yield* session.owns())) return;
    for (const outcome of called.value.outcomes) {
      const item = called.value.prepared.find((entry) => entry.ready.unit.key === outcome.id);
      if (item === undefined) continue;
      if (outcome.ok) yield* this.acknowledge(item.ready, outcome.event, item.journal);
      else if (outcome.error.status === 409 || outcome.error.status === 412) {
        yield* context.queue.mutate(item.ready.unit.key, (unit) => ({
          ...unit,
          state: "dirty",
          nextAttemptAt: 0,
        }));
      } else yield* reportFailure(context, session, outcome.error, item.ready.unit);
    }
  });
  readonly flush = Effect.fn("routines.outbound.flush")(function* (this: Outbound) {
    const context = this.context;
    const at = yield* Clock.currentTimeMillis;
    const due = yield* context.options.ledger.unit.due(at, 100);
    for (const { session } of context.sessions.values()) {
      if (
        (yield* context.options.ledger.cursor.get("initialized:" + session.binding.calendar.id)) !==
        "yes"
      )
        continue;
      const scan = yield* context.options.ledger.cursor.get("scan:" + session.binding.calendar.id);
      if (scan !== null && scan !== "") continue;
      const candidates = due.filter((unit) => unit.calendar === session.binding.calendar.id);
      const ready: Ready[] = [];
      for (const unit of candidates) {
        const result = yield* Effect.result(this.prepare(session, unit));
        if (Result.isFailure(result)) {
          yield* reportFailure(context, session, result.failure, unit);
          continue;
        }
        if (result.success !== null) ready.push(result.success);
      }
      const destructive = ready.filter((item) => item.plan.destructive);
      const all = (yield* context.options.ledger.unit.all(session.binding.calendar.id)).filter(
        (unit) => unit.kind !== "exception" && unit.state !== "ended",
      );
      const guarded =
        destructive.filter((item) => item.unit.kind === "series").length > 5 ||
        destructive.length > all.length * 0.2;
      const accepted: Ready[] = [];
      for (const item of ready) {
        const signature = canonicalJson(item.plan.mutation);
        const released = yield* context.options.ledger.cursor.get("release:" + item.unit.key);
        if (guarded && item.plan.destructive && released !== signature) {
          yield* context.queue.mutate(item.unit.key, (unit) => ({
            ...unit,
            state: "held",
          }));
          yield* context.options.ledger.cursor.set("held:" + item.unit.key, signature);
        } else if (item.plan.mutation === null) yield* this.acknowledge(item, item.remote, null);
        else accepted.push(item);
      }
      if (accepted.length !== 0) yield* this.send(session, accepted);
    }
  });
}
