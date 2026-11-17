import { Clock, Result, Context, DateTime, Effect, Layer, Random, Semaphore } from "effect";
import { canonicalJson, firstRef, nodesOfKind, tagChains, type NodeLike } from "@kb/model";
import {
  eventId,
  project,
  readAccount,
  readCalendar,
  readRoutine,
  readSyncStatus,
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

import { pushPlan, type PushOperation, type Snapshot } from "./push-plan.ts";
export interface EngineOptions {
  readonly host: RoutineHost;
  readonly client: (binding: CalendarBinding) => Effect.Effect<CalendarPort, SyncError>;
  readonly origin: string;
  readonly runner: string;
}
interface Work extends Snapshot {
  readonly source: string;
  /**
   * The nodes this work has said wait (DESIGN-UI.md → The routines calendar,
   * sync status): each node a write it plans is for, and whether that node
   * had a status before. The series parent is one, so a change to one
   * instance never says its whole series waits.
   */
  readonly marked: ReadonlyMap<string, boolean>;
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
/**
 * What a send says of the nodes its work marked: each node a write of its
 * plan is for takes its outcome in `outcomes`, synced or failed, and a node
 * said to wait whose write the plan no longer holds (its change was taken
 * back before it was sent) is as it was sent, synced again, whatever the
 * plan's own writes met.
 */
const settle = Effect.fn("routines.engine.settle")(function* (
  options: EngineOptions,
  work: Work,
  outcomes: ReadonlyMap<string, SyncStatus>,
) {
  for (const [id, status] of outcomes) yield* options.host.status(id, status);
  for (const [id, had] of work.marked)
    if (had && !outcomes.has(id) && work.nodes.has(id))
      yield* options.host.status(id, { state: "synced", message: "" });
});
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
  if (queue.get(node.id) === work) {
    const at = yield* Clock.currentTimeMillis;
    yield* settle(
      options,
      work,
      new Map(
        receipts.map(({ node: written, response }) => [
          written.id,
          syncedStatus(work, written, response, at),
        ]),
      ),
    );
  }
  applied.set(node.id, work);
  return true;
});

const previewNodes = Effect.fn("routines.previewNodes")(function* (options: EngineOptions) {
  const nodes = yield* options.host.read;
  return yield* Effect.try({
    try: () =>
      nodesOfKind(nodes, T.routine).map((node) =>
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
          // The writes that failed are the plan's; one with no node fails its series.
          const failed = planNodes(work, applied.get(id), at, options.origin);
          const status: SyncStatus = { state: "error", message: error.code };
          yield* settle(
            options,
            work,
            new Map((failed.length === 0 ? [work.node] : failed).map((n) => [n.id, status])),
          );
        }),
      }),
    );
  }
});
/**
 * The nodes a plan's writes are for: the series parent when its own event
 * changes, and each instance whose fact does. A write with no node (a day
 * back to its series' default, a series retired) has none to wait on; a
 * plan that cannot be made waits on the series.
 */
function planNodes(
  current: Snapshot,
  previous: Snapshot | undefined,
  now: number,
  origin: string,
): readonly NodeLike[] {
  let operations: readonly PushOperation[];
  try {
    operations = pushPlan(current, previous, now, origin);
  } catch {
    return [current.node];
  }
  // GAP [[01M7JGRXEA5AWPZS3SKTRQY45E]] a day back to its series' default waits on no node.
  return operations.flatMap((operation) => (operation.node === null ? [] : [operation.node]));
}
/**
 * What one queued change says waits: the nodes its plan's writes are for,
 * against `against` (none while `marks` is false), and every node the work
 * has said waits so far, each with whether it had a status before.
 */
function waitsOf(
  snapshot: Snapshot,
  change: {
    readonly against: Snapshot | undefined;
    readonly earlier: ReadonlyMap<string, boolean> | undefined;
    readonly marks: boolean;
  },
  at: number,
  origin: string,
): { readonly waits: readonly NodeLike[]; readonly marked: ReadonlyMap<string, boolean> } {
  const { against, earlier, marks } = change;
  const waits = marks ? planNodes(snapshot, against, at, origin) : [];
  const marked = new Map(earlier);
  for (const waiting of waits)
    if (!marked.has(waiting.id)) marked.set(waiting.id, readSyncStatus(waiting) !== null);
  return { waits, marked };
}
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
    for (const node of nodesOfKind(nodes, T.routine)) {
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
      const snapshot: Snapshot = { node, nodes, binding, removed: false };
      // What waits: an edit, the writes its change makes (against what was
      // last seen); a retry, the writes it sends again (against what was sent).
      // Opening reads the store as it is, and says nothing waits.
      const { waits, marked } = waitsOf(
        snapshot,
        {
          against: retry ? applied.get(node.id) : previous,
          earlier: pending?.marked,
          marks: initialized || retry,
        },
        at,
        options.origin,
      );
      const work: Work = {
        ...snapshot,
        source,
        marked,
        first,
        last: at,
        attempts: 0,
        due: retry ? at : settleAt(first, at),
        startup: !initialized,
      };
      seen.set(node.id, work);
      queue.set(node.id, work);
      for (const waiting of waits)
        yield* options.host.status(waiting.id, { state: "pending", message: "" });
    }
    for (const [id, previous] of seen) {
      if (active.has(id) || previous.removed) continue;
      const work = {
        ...previous,
        removed: true,
        marked: new Map<string, boolean>(),
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
    const nodes = yield* options.host.read;
    const { isA } = tagChains((id) => nodes.get(id));
    return {
      nodes: [...nodes.values()]
        .filter((node) => isA(node, T.routine) || isA(node, T.occurrence))
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
