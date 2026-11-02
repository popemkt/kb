import { Context, Layer, Clock, Effect, Semaphore } from "effect";
import { typeRefsOf } from "@kb/model";
import {
  project,
  readRoutine,
  readCalendar,
  DEFAULT_ROUTINE_ZONE,
  ROUTINE_TAGS as T,
  eventId,
  SyncError,
  type RoutineOption,
} from "@kb/routines";
import { RoutineGraph } from "./graph.ts";
import { EngineContext, type EngineOptions } from "./context.ts";
import { localProjection } from "./occurrences.ts";
import { Inbound } from "./inbound.ts";
import { Outbound } from "./outbound.ts";

function diagnostics(context: EngineContext) {
  const options = context.options;
  const preview = Effect.fn("routines.engine.preview")(function* () {
    const nodes = yield* options.host.read;
    return [...nodes.values()]
      .filter((node) => typeRefsOf(node).includes(T.routine))
      .map((node) => {
        try {
          const first = readRoutine(node, DEFAULT_ROUTINE_ZONE);
          const calendarNode = nodes.get(first.calendar);
          const zone =
            calendarNode === undefined ? DEFAULT_ROUTINE_ZONE : readCalendar(calendarNode).zone;
          return {
            id: node.id,
            fields: project(
              readRoutine(node, zone).routine,
              options.origin + "/node/" + encodeURIComponent(node.id),
              0,
            ),
            issue: null,
          };
        } catch {
          return { id: node.id, fields: null, issue: "invalid_rule" };
        }
      });
  });
  const status = Effect.fn("routines.engine.status")(function* () {
    const calendars = [];
    for (const { session } of context.sessions.values()) {
      const units = yield* options.ledger.unit.all(session.binding.calendar.id);
      calendars.push({ id: session.binding.calendar.id, reason: session.reason, units });
    }
    return { calendars, log: yield* options.ledger.log.tail(100) };
  });
  const publish = Effect.fn("routines.engine.publish")(function* () {
    const priority = [
      "auth needed",
      "deleted in Google",
      "conflict",
      "held",
      "invalid rule",
      "failed",
    ] satisfies RoutineOption<"issue">[];
    const issues = new Map<string, RoutineOption<"issue"> | null>();
    for (const { session } of context.sessions.values())
      for (const unit of yield* options.ledger.unit.all(session.binding.calendar.id)) {
        const issue =
          unit.state === "failed"
            ? unit.lastError?.code === "invalid_rule"
              ? "invalid rule"
              : unit.lastError?.code === "auth_needed"
                ? "auth needed"
                : "failed"
            : unit.state === "deleted"
              ? "deleted in Google"
              : unit.state === "conflict"
                ? "conflict"
                : unit.state === "held"
                  ? "held"
                  : null;
        const previous = issues.get(unit.routineId) ?? null;
        if (
          !issues.has(unit.routineId) ||
          (issue !== null &&
            (previous === null || priority.indexOf(issue) < priority.indexOf(previous)))
        )
          issues.set(unit.routineId, issue);
      }
    for (const [id, issue] of issues) yield* options.host.issue(id, issue);
  });
  return { preview, status, publish };
}

export const makeRoutineEngine = Effect.fn("routines.engine.make")(function* (
  options: EngineOptions,
) {
  const context = new EngineContext(options);
  const inbound = new Inbound(context);
  const outbound = new Outbound(context);
  const pushLock = yield* Semaphore.make(1);
  const pollLock = yield* Semaphore.make(1);
  const start = context.start();
  yield* Effect.addFinalizer(() => context.close().pipe(Effect.orElseSucceed(() => undefined)));
  const { preview, status, publish } = diagnostics(context);
  const push = pushLock.withPermit(outbound.flush().pipe(Effect.tap(publish)));
  const poll = (force = false) => pollLock.withPermit(inbound.poll(force));
  const syncNow = Effect.fn("routines.engine.syncNow")(function* () {
    yield* context.refresh({
      kind: "sync-now",
      at: yield* Clock.currentTimeMillis,
      revision: context.revision,
    });
    yield* poll(true);
  });
  const release = Effect.fn("routines.engine.release")(function* (keys: readonly string[]) {
    for (const key of keys) {
      const held = yield* options.ledger.cursor.get("held:" + key);
      if (held === null) return yield* new SyncError({ status: 400, code: "not_held" });
      yield* options.ledger.cursor.set("release:" + key, held);
      yield* context.queue.mutate(key, (unit) => ({ ...unit, state: "dirty", nextAttemptAt: 0 }));
    }
    return undefined;
  });
  const recreate = Effect.fn("routines.engine.recreate")(function* (key: string) {
    const unit = yield* options.ledger.unit.get(key);
    if (unit === null || unit.state !== "deleted" || unit.kind === "exception")
      return yield* new SyncError({ status: 400, code: "not_deleted" });
    const generation = unit.generation + 1;
    const nextKey = yield* eventId(unit.calendar, unit.routineId, "series", generation);
    yield* options.ledger.unit.put(
      {
        ...unit,
        key: nextKey,
        generation,
        state: "dirty",
        base: null,
        etag: null,
        pending: null,
        conflict: null,
        lastError: null,
        nextAttemptAt: 0,
        version: 0,
      },
      0,
    );
    yield* context.queue.mutate(key, (current) => ({ ...current, state: "ended" }));
    return undefined;
  });
  const resolve = Effect.fn("routines.engine.keepKb")(function* (key: string) {
    const unit = yield* options.ledger.unit.get(key);
    if (unit === null) return yield* new SyncError({ status: 404, code: "not_found" });
    const session = context.sessions.get(unit.calendar)?.session;
    const local =
      session === undefined
        ? null
        : yield* Effect.try({
            try: () => localProjection(context, unit, session.binding.calendar.zone),
            catch: () => new SyncError({ status: 400, code: "invalid_rule" }),
          });
    const restoredBase =
      unit.kind === "exception" && unit.state === "deleted" && local !== null
        ? { ...local, status: "cancelled" as const }
        : null;
    yield* context.queue.mutate(key, (current) => ({
      ...current,
      base: restoredBase ?? current.conflict?.remote ?? current.base,
      conflict: null,
      state: "dirty",
      nextAttemptAt: 0,
    }));
    return undefined;
  });
  const run = Effect.forkScoped(
    start.pipe(
      Effect.andThen(
        Effect.gen(function* () {
          const safe = (effect: Effect.Effect<unknown, SyncError>) =>
            effect.pipe(
              Effect.catch((error) =>
                options.ledger.log
                  .append({ at: 0, key: null, code: error.code })
                  .pipe(Effect.orElseSucceed(() => undefined)),
              ),
            );
          yield* Effect.forkScoped(
            Effect.forever(safe(context.tail()).pipe(Effect.andThen(Effect.sleep("1 second")))),
          );
          yield* Effect.forkScoped(
            Effect.forever(safe(push).pipe(Effect.andThen(Effect.sleep("1 second")))),
          );
          yield* Effect.forkScoped(
            Effect.forever(safe(poll()).pipe(Effect.andThen(Effect.sleep("1 second")))),
          );
        }),
      ),
    ),
  );
  return {
    start,
    preview,
    status,
    tail: context.tail(),
    push,
    poll,
    syncNow,
    release,
    recreate,
    resolve,
    run,
  };
});

export class RoutineEngine extends Context.Service<
  RoutineEngine,
  Effect.Success<ReturnType<typeof makeRoutineEngine>>
>()("@kb/routines/Engine") {
  static layer(options: Omit<EngineOptions, "host">) {
    return Layer.effect(
      RoutineEngine,
      Effect.gen(function* () {
        const host = yield* RoutineGraph;
        return yield* makeRoutineEngine({ ...options, host });
      }),
    );
  }
}
