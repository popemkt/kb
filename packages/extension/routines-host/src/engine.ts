import { Clock, Result, Context, DateTime, Effect, Layer, Random, Semaphore } from "effect";
import { canonicalJson, firstRef, typeRefsOf, type NodeLike } from "@kb/model";
import {
  eventId,
  project,
  readAccount,
  readCalendar,
  readRoutine,
  retryDelay,
  routineInputs,
  routineZone,
  settleAt,
  SyncError,
  ROUTINE_FIELDS as F,
  ROUTINE_TAGS as T,
  type CalendarBinding,
  type CalendarPort,
  type CalendarResult,
  type SyncStatus,
} from "@kb/routines";
import { calendarBindingDigest } from "./binding.ts";
import { RoutineGraph, type RoutineHost } from "./graph.ts";

import { pushPlan, type Snapshot } from "./push-plan.ts";
export interface EngineOptions {
  readonly host: RoutineHost;
  readonly client: (binding: CalendarBinding) => Effect.Effect<CalendarPort, SyncError>;
  readonly origin: string;
  readonly runner: string;
}
interface Work extends Snapshot {
  readonly source: string;
  readonly first: number;
  readonly last: number;
  readonly attempts: number;
  readonly due: number;
  readonly startup: boolean;
}
function syncedStatus(
  work: Work,
  node: NodeLike,
  response: CalendarResult,
  at: number,
): SyncStatus {
  return {
    state: "synced",
    message: "",
    eventId: response.id,
    url: response.url,
    ...(work.startup && firstRef(F.status)(node.props) === F.status + ".synced"
      ? {}
      : { at: DateTime.formatIso(DateTime.makeUnsafe(at)) }),
  };
}
const pushOne = Effect.fn("routines.engine.pushOne")(function* (
  options: EngineOptions,
  work: Work,
  applied: Map<string, Work>,
  queue: Map<string, Work>,
) {
  const { node, binding } = work;
  if (binding.calendar.mode !== "on" || binding.calendar.calendarId === "") return false;
  if (!(yield* options.host.trusted(yield* calendarBindingDigest(binding)))) return false;
  const now = yield* Clock.currentTimeMillis;
  const operations = yield* Effect.try({
    try: () => pushPlan(work, applied.get(node.id), now, options.origin),
    catch: () => new SyncError({ status: 400, code: "invalid_rule" }),
  });
  const receipts: { node: NodeLike; response: CalendarResult }[] = [];
  for (const operation of operations) {
    const target = operation.snapshot.binding;
    if (!(yield* options.host.trusted(yield* calendarBindingDigest(target)))) return false;
    const client = yield* options.client(target);
    const parent = yield* eventId(target.calendar.id, node.id, "series", 0);
    const id =
      operation.original === null
        ? parent
        : (yield* client.instance(
            target.calendar.calendarId,
            parent,
            operation.original,
            target.calendar.zone,
          )).id;
    const response = yield* client.put(target.calendar.calendarId, id, operation.fields);
    if (operation.node !== null) receipts.push({ node: operation.node, response });
  }
  if (queue.get(node.id) === work)
    for (const receipt of receipts)
      yield* options.host.status(
        receipt.node.id,
        syncedStatus(work, receipt.node, receipt.response, yield* Clock.currentTimeMillis),
      );
  applied.set(node.id, work);
  return true;
});

const previewNodes = Effect.fn("routines.previewNodes")(function* (options: EngineOptions) {
  const nodes = yield* options.host.read;
  return yield* Effect.try({
    try: () =>
      [...nodes.values()]
        .filter((node) => typeRefsOf(node).includes(T.routine))
        .map((node) =>
          project(
            readRoutine(node, routineZone(node, nodes)).routine,
            options.origin + "/node/" + node.id,
            0,
          ),
        ),
    catch: () => new SyncError({ status: 400, code: "invalid_rule" }),
  });
});
const pushQueue = Effect.fn("routines.engine.pushQueue")(function* (
  options: EngineOptions,
  queue: Map<string, Work>,
  releases: Map<string, string>,
  applied: Map<string, Work>,
) {
  const at = yield* Clock.currentTimeMillis;
  // Count the whole operation before taking due work. Held signatures include inputs.
  const destructive = new Set<string>();
  for (const [id, work] of queue) {
    const plan = yield* Effect.result(
      Effect.try({
        try: () => pushPlan(work, applied.get(id), at, options.origin),
        catch: () => new SyncError({ status: 400, code: "invalid_rule" }),
      }),
    );
    if (Result.isSuccess(plan) && plan.success.some((operation) => operation.retiresSeries))
      destructive.add(id);
  }
  for (const [id, work] of queue) {
    if (work.attempts >= 10 || work.due > at) continue;
    const signature = canonicalJson([work.source, work.removed]);
    if (destructive.has(id) && destructive.size > 5 && releases.get(id) !== signature) {
      yield* options.host.status(id, {
        state: "error",
        message: "Deletion held: release required",
      });
      continue;
    }
    yield* pushOne(options, work, applied, queue).pipe(
      Effect.matchEffect({
        onSuccess: (sent) =>
          Effect.sync(() => {
            if (sent && queue.get(id) === work) queue.delete(id);
          }),
        onFailure: Effect.fn("routines.engine.failure")(function* (error) {
          if (queue.get(id) !== work) return;
          const attempts = work.attempts + 1;
          const transient = error.status === 0 || error.status === 429 || error.status >= 500;
          queue.set(id, {
            ...work,
            attempts: transient ? attempts : 10,
            due:
              at +
              retryDelay(
                attempts,
                yield* Random.next,
                error.status === 429 ? "quota" : "transport",
                error.retryAfter,
              ),
          });
          yield* options.host.status(id, { state: "error", message: error.code });
        }),
      }),
    );
  }
});
export const makeRoutineEngine = Effect.fn("routines.engine.make")(function* (
  options: EngineOptions,
) {
  const queue = new Map<string, Work>();
  const seen = new Map<string, Work>();
  const applied = new Map<string, Work>();
  const releases = new Map<string, string>();
  let revision = 0;
  let initialized = false;
  const lock = yield* Semaphore.make(1);
  const refresh = Effect.fn("routines.engine.refresh")(function* (retry: boolean) {
    const nodes = yield* options.host.read;
    const at = yield* Clock.currentTimeMillis;
    const active = new Set<string>();
    for (const node of nodes.values()) {
      if (!typeRefsOf(node).includes(T.routine)) continue;
      const calendar = nodes.get(firstRef(F.calendar)(node.props) ?? "");
      if (calendar === undefined) continue;
      const config = readCalendar(calendar);
      const account = nodes.get(config.account);
      const binding = {
        calendar: config,
        account: account === undefined ? null : readAccount(account),
      };
      active.add(node.id);
      const source = canonicalJson([routineInputs(node, nodes, config.zone).value, binding]);
      const previous = seen.get(node.id);
      if (previous?.source === source && !previous.removed && (!retry || !queue.has(node.id)))
        continue;
      const pending = queue.get(node.id);
      const first = pending?.first ?? at;
      const work: Work = {
        node,
        nodes,
        binding,
        source,
        removed: false,
        first,
        last: at,
        attempts: 0,
        due: retry ? at : settleAt(first, at),
        startup: !initialized,
      };
      seen.set(node.id, work);
      queue.set(node.id, work);
      if (initialized || retry)
        yield* options.host.status(node.id, { state: "pending", message: "" });
    }
    for (const [id, previous] of seen) {
      if (active.has(id) || previous.removed) continue;
      const work = {
        ...previous,
        removed: true,
        first: at,
        last: at,
        attempts: 0,
        due: settleAt(at, at),
        startup: false,
      };
      seen.set(id, work);
      queue.set(id, work);
    }
    initialized = true;
  });
  const tail = Effect.gen(function* () {
    const page = yield* options.host.changes(revision);
    if (!initialized || page.changes.length !== 0) yield* refresh(false);
    revision = page.through;
  });
  const push = lock.withPermit(pushQueue(options, queue, releases, applied));
  const syncNow = Effect.fn("routines.engine.syncNow")(function* () {
    yield* refresh(true);
    for (const [id, work] of queue) queue.set(id, { ...work, attempts: 0, due: 0 });
  });
  const release = Effect.fn("routines.engine.release")(function* (keys: readonly string[]) {
    for (const key of keys) {
      const work = queue.get(key);
      if (work === undefined) return yield* new SyncError({ status: 400, code: "not_held" });
      releases.set(key, canonicalJson([work.source, work.removed]));
    }
    return undefined;
  });
  const preview = previewNodes(options);
  const status = Effect.fn("routines.engine.status")(function* () {
    return {
      nodes: [...(yield* options.host.read).values()]
        .filter(
          (node) => typeRefsOf(node).includes(T.routine) || typeRefsOf(node).includes(T.occurrence),
        )
        .map((node) => ({ id: node.id, props: node.props })),
      pendingDeletions: [...queue.entries()].filter(([, work]) => work.removed).map(([id]) => id),
    };
  });
  const run = Effect.forkScoped(
    Effect.forever(
      tail.pipe(
        Effect.andThen(push),
        Effect.orElseSucceed(() => undefined),
        Effect.andThen(Effect.sleep("1 second")),
      ),
    ),
  );
  return { start: refresh(false), tail, push, syncNow, release, preview, status, run };
});
export class RoutineEngine extends Context.Service<
  RoutineEngine,
  Effect.Success<ReturnType<typeof makeRoutineEngine>>
>()("@kb/routines/Engine") {
  static layer(options: Omit<EngineOptions, "host">) {
    return Layer.effect(
      RoutineEngine,
      Effect.gen(function* () {
        return yield* makeRoutineEngine({ ...options, host: yield* RoutineGraph });
      }),
    );
  }
}
