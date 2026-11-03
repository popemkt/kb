import { Clock, Context, DateTime, Effect, Layer, Random, Semaphore } from "effect";
import {
  addDays,
  canonicalJson,
  firstRef,
  formatDay,
  parseDay,
  typeRefsOf,
  type NodeLike,
} from "@kb/model";
import {
  eventId,
  endSeries,
  project,
  readAccount,
  readCalendar,
  readOccurrence,
  readRoutine,
  retryDelay,
  routineInputs,
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

export interface EngineOptions {
  readonly host: RoutineHost;
  readonly client: (binding: CalendarBinding) => Effect.Effect<CalendarPort, SyncError>;
  readonly origin: string;
  readonly runner: string;
}
interface Work {
  readonly node: NodeLike;
  readonly nodes: ReadonlyMap<string, NodeLike>;
  readonly binding: CalendarBinding;
  readonly source: string;
  readonly removed: boolean;
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
  const client = yield* options.client(binding);
  const { routine } = yield* Effect.try({
    try: () => readRoutine(node, binding.calendar.zone),
    catch: () => new SyncError({ status: 400, code: "invalid_rule" }),
  });
  const key = yield* eventId(binding.calendar.id, node.id, "series", 0);
  const backlink = options.origin + "/node/" + encodeURIComponent(node.id);
  let fields = yield* Effect.try({
    try: () => project(routine, backlink, 0),
    catch: () => new SyncError({ status: 400, code: "invalid_rule" }),
  });
  if (work.removed) {
    const now = yield* Clock.currentTimeMillis;
    const today = parseDay(
      DateTime.formatIsoDate(DateTime.makeZonedUnsafe(now, { timeZone: routine.zone })),
    );
    if (today === null) return yield* new SyncError({ status: 400, code: "invalid_rule" });
    fields =
      fields.recurrence.length === 0
        ? { ...fields, status: "cancelled" }
        : endSeries(fields, formatDay(addDays(today, -1)));
  }
  const parent = yield* client.put(binding.calendar.calendarId, key, fields);
  if (!work.removed) {
    for (const id of new Set([...node.children, ...(applied.get(node.id)?.node.children ?? [])])) {
      const child = work.nodes.get(id) ?? applied.get(node.id)?.nodes.get(id);
      if (child === undefined || !typeRefsOf(child).includes(T.occurrence)) continue;
      const occurrence = yield* Effect.try({
        try: () => readOccurrence(child),
        catch: () => new SyncError({ status: 400, code: "invalid_occurrence" }),
      });
      const fact = node.children.includes(id) ? occurrence : null;
      const instance = yield* client.instance(
        binding.calendar.calendarId,
        parent.id,
        { day: occurrence.on, at: routine.at, zone: routine.zone },
        binding.calendar.zone,
      );
      const response = yield* client.put(
        binding.calendar.calendarId,
        instance.id,
        project(routine, backlink, 0, { kind: "instance", on: occurrence.on, occurrence: fact }),
      );
      if (queue.get(node.id) === work)
        yield* options.host.status(
          child.id,
          syncedStatus(work, child, response, yield* Clock.currentTimeMillis),
        );
    }
    if (queue.get(node.id) === work)
      yield* options.host.status(
        node.id,
        syncedStatus(work, node, parent, yield* Clock.currentTimeMillis),
      );
  }
  applied.set(node.id, work);
  return true;
});

const previewNodes = Effect.fn("routines.previewNodes")(function* (options: EngineOptions) {
  const nodes = yield* options.host.read;
  return yield* Effect.try({
    try: () =>
      [...nodes.values()]
        .filter((node) => typeRefsOf(node).includes(T.routine))
        .map((node) => {
          const calendar = nodes.get(firstRef(F.calendar)(node.props) ?? "");
          const zone = calendar === undefined ? "Asia/Ho_Chi_Minh" : readCalendar(calendar).zone;
          return project(readRoutine(node, zone).routine, options.origin + "/node/" + node.id, 0);
        }),
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
  const deletions = [...queue.values()].filter((work) => work.removed);
  for (const [id, work] of queue) {
    if (work.attempts >= 10 || work.due > at) continue;
    const signature = canonicalJson([work.source, work.removed]);
    if (work.removed && deletions.length > 5 && releases.get(id) !== signature) {
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
      if (work === undefined || !work.removed)
        return yield* new SyncError({ status: 400, code: "not_held" });
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
