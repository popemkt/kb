/**
 * Event sync's engine (docs/research/2026-11-02-kb-routines-gcal.md → Push
 * reconciles against Google). Each pass lists every kb calendar, plans it
 * against the store (`reconcile`) and sends what differs. It writes nothing to
 * the store: what it knows of its own work is the statuses it keeps here and
 * serves, and the scheduling around them. A fresh process rebuilds both with
 * its first pass.
 */
import {
  Clock,
  Context,
  DateTime,
  Deferred,
  Effect,
  Layer,
  Random,
  Result,
  Semaphore,
} from "effect";
import { firstRef, nodesOfKind, type NodeLike } from "@kb/model";
import {
  project,
  readAccount,
  readCalendar,
  readRoutine,
  routineZone,
  sentDigest,
  SyncError,
  ROUTINE_FIELDS as F,
  ROUTINE_TAGS as T,
  type CalendarBinding,
  type CalendarConfig,
  type CalendarPort,
  type RemoteEvent,
  type SyncStatus,
  type SyncStatuses,
} from "@kb/routines";
import { calendarBindingDigest } from "./binding.ts";
import { RoutineGraph, type RoutineHost } from "./graph.ts";
import {
  reconcile,
  type CalendarPlan,
  type EventPlan,
  type Target,
  type Write,
} from "./reconcile.ts";
import { Schedule } from "./schedule.ts";
import { StatusBook, targetKey } from "./status-book.ts";

export interface EngineOptions {
  readonly host: RoutineHost;
  readonly client: (binding: CalendarBinding) => Effect.Effect<CalendarPort, SyncError>;
  readonly origin: string;
  readonly runner: string;
}
/** A calendar the engine sends to, with the events on it. */
interface Bound {
  readonly calendar: CalendarConfig;
  readonly binding: CalendarBinding;
  readonly routines: readonly NodeLike[];
}
/** A calendar listed and planned in a pass, with the client its writes go through. */
interface Planned {
  readonly bound: Bound;
  readonly client: CalendarPort;
  readonly plan: CalendarPlan;
}
/** What the engine keeps between passes, all of it in memory. */
interface State {
  readonly options: EngineOptions;
  readonly book: StatusBook;
  readonly schedule: Schedule;
  /** The last list read of each calendar: what an edit plans its waiting writes against. */
  readonly lists: Map<string, readonly RemoteEvent[]>;
  /** Each event whose ending a person released, with the Google id of the series released. */
  readonly released: Map<string, string>;
}
/** More endings than this in one pass wait for a release, each one. */
const ENDINGS_AT_ONCE = 5;
const HELD = "Deletion held: release required";

/** Every calendar whose sync is on and which names its Google calendar, with its events. */
// GAP [[01M7KTB23TP44SDM0D9XY3E5GM]] a Google calendar no calendar node names now is never listed, so its series are not ended
function boundCalendars(nodes: ReadonlyMap<string, NodeLike>): readonly Bound[] {
  const routines = nodesOfKind(nodes, T.routine);
  const bound: Bound[] = [];
  for (const node of nodesOfKind(nodes, T.calendar)) {
    let calendar: CalendarConfig;
    try {
      calendar = readCalendar(node);
    } catch {
      continue;
    }
    if (calendar.mode !== "on" || calendar.calendarId === "") continue;
    const account = nodes.get(calendar.account);
    bound.push({
      calendar,
      binding: { calendar, account: account === undefined ? null : readAccount(account) },
      routines: routines.filter((routine) => firstRef(F.calendar)(routine.props) === node.id),
    });
  }
  return bound;
}
/** The events a change to `ids` concerns: each event, the event an occurrence is under, and every event on a changed calendar or account. */
function concerned(ids: readonly string[], nodes: ReadonlyMap<string, NodeLike>): Set<string> {
  const routines = nodesOfKind(nodes, T.routine);
  const keys = new Set<string>();
  for (const id of ids) {
    const parent = routines.find((routine) => routine.id === id || routine.children.includes(id));
    if (parent !== undefined) {
      keys.add(parent.id);
      continue;
    }
    const node = nodes.get(id);
    const calendars =
      node === undefined
        ? []
        : nodesOfKind(nodes, T.calendar).filter(
            (calendar) => calendar.id === id || firstRef(F.account)(calendar.props) === node.id,
          );
    for (const calendar of calendars) {
      keys.add(calendar.id);
      for (const routine of routines)
        if (firstRef(F.calendar)(routine.props) === calendar.id) keys.add(routine.id);
    }
    // A node that is gone may be an event whose series now ends: its own key.
    if (node === undefined) keys.add(id);
  }
  return keys;
}
const iso = (at: number) => DateTime.formatIso(DateTime.makeUnsafe(at));
const failure = (error: SyncError): SyncStatus => ({ state: "error", message: error.code });
const sentAt = (response: { readonly id: string; readonly url?: string }, now: number) =>
  ({
    state: "synced",
    message: "",
    eventId: response.id,
    url: response.url,
    at: iso(now),
  }) satisfies SyncStatus;

/** `key` failed at `now`: its schedule backs off by a jittered delay, or stops. */
const failed = (state: State, key: string, error: SyncError, now: number) =>
  Random.next.pipe(Effect.map((jitter) => state.schedule.failed(key, error, now, jitter)));

/** List and plan every calendar this pass reaches; a calendar that cannot be listed says why. */
const listAndPlan = Effect.fnUntraced(function* (
  state: State,
  nodes: ReadonlyMap<string, NodeLike>,
  now: number,
) {
  const planned: Planned[] = [];
  for (const bound of boundCalendars(nodes)) {
    const key = bound.calendar.id;
    if (!(yield* state.options.host.trusted(yield* calendarBindingDigest(bound.binding)))) continue;
    if (state.schedule.waits(key, now)) continue;
    const listed = yield* state.options.client(bound.binding).pipe(
      Effect.flatMap((client) =>
        client.list(bound.calendar.calendarId).pipe(Effect.map((list) => ({ client, list }))),
      ),
      Effect.result,
    );
    if (Result.isFailure(listed)) {
      state.book.set({ kind: "calendar", calendar: key }, failure(listed.failure));
      yield* failed(state, key, listed.failure, now);
      continue;
    }
    const { client, list } = listed.success;
    state.lists.set(key, list);
    const plan = yield* reconcile(bound.calendar, bound.routines, {
      nodes,
      list,
      now,
      origin: state.options.origin,
    });
    planned.push({ bound, client, plan });
  }
  return planned;
});

/**
 * Send one write, to its id or to the instance the lookup finds, and keep
 * what Google now holds in the calendar's last list, so an edit after it
 * plans against it.
 */
const send = Effect.fnUntraced(function* (
  state: State,
  { bound, client }: Pick<Planned, "bound" | "client">,
  write: Write,
) {
  const to = write.to;
  const calendarId = bound.calendar.calendarId;
  const id =
    to.kind === "id"
      ? to.id
      : (yield* client.instance(calendarId, to.series, to.original, to.zone)).id;
  const response = yield* client.put(calendarId, id, write.fields);
  const last = state.lists.get(bound.calendar.id) ?? [];
  const cancelled = write.fields.status === "cancelled";
  const now: RemoteEvent = {
    id: response.id,
    url: response.url,
    exception:
      to.kind === "lookup"
        ? { series: to.series, original: to.original }
        : (last.find((event) => event.id === response.id)?.exception ?? null),
    cancelled,
    fields: cancelled ? null : write.fields,
    digest: cancelled ? null : yield* sentDigest(write.fields),
  };
  state.lists.set(bound.calendar.id, [...last.filter((event) => event.id !== response.id), now]);
  return response;
});

/** Count every ending in the pass before sending any: more than five wait for a release. */
function holdEndings({ book, released }: State, planned: readonly Planned[]): void {
  const endings = planned.flatMap(({ plan }) => plan.endings);
  book.held.clear();
  if (endings.length <= ENDINGS_AT_ONCE) return;
  for (const ending of endings)
    if (released.get(ending.routine) !== ending.to.id) book.held.set(ending.routine, ending.to.id);
}

/** End each gone series not held or waiting; each calendar's status says how its endings went. */
const sendEndings = Effect.fnUntraced(function* (
  state: State,
  planned: readonly Planned[],
  now: number,
) {
  for (const entry of planned) {
    let refused: SyncError | null = null;
    for (const ending of entry.plan.endings) {
      if (state.book.held.has(ending.routine) || state.schedule.waits(ending.routine, now))
        continue;
      const sent = yield* Effect.result(send(state, entry, ending));
      if (Result.isFailure(sent)) {
        refused = sent.failure;
        yield* failed(state, ending.routine, sent.failure, now);
        continue;
      }
      state.schedule.sent(ending.routine);
      state.released.delete(ending.routine);
    }
    const held = entry.plan.endings.some((ending) => state.book.held.has(ending.routine));
    state.book.set(
      { kind: "calendar", calendar: entry.bound.calendar.id },
      refused !== null
        ? failure(refused)
        : held
          ? { state: "error", message: HELD }
          : { state: "synced", message: "" },
    );
  }
});

/**
 * One event's part of a pass: the targets Google holds are synced, and its
 * writes go in order until one fails, which stops the rest, keeping the
 * statuses they had. Returns the targets the plan names.
 */
const sendEvent = Effect.fnUntraced(function* (
  state: State,
  entry: Planned,
  event: EventPlan,
  now: number,
) {
  const series: Target = { kind: "series", routine: event.routine };
  if (event.invalid !== null) {
    state.book.set(series, failure(event.invalid));
    state.schedule.stopped(event.routine, now);
    return [series];
  }
  for (const { target, remote } of event.held) state.book.holds(target, remote);
  const named = [
    series,
    ...event.held.map(({ target }) => target),
    ...event.writes.map(({ target }) => target),
  ];
  if (state.schedule.waits(event.routine, now)) return named;
  for (const write of event.writes) {
    const sent = yield* Effect.result(send(state, entry, write));
    if (Result.isFailure(sent)) {
      state.book.set(write.target, failure(sent.failure));
      yield* failed(state, event.routine, sent.failure, now);
      return named;
    }
    state.book.set(write.target, sentAt(sent.success, now));
  }
  state.schedule.sent(event.routine);
  return named;
});

/** An edit's waiting writes, planned against each calendar's last list, show pending. */
const markWaiting = Effect.fnUntraced(function* (
  state: State,
  nodes: ReadonlyMap<string, NodeLike>,
  keys: ReadonlySet<string>,
  now: number,
) {
  for (const bound of boundCalendars(nodes)) {
    const list = state.lists.get(bound.calendar.id);
    if (list === undefined) continue;
    const routines = bound.routines.filter((routine) => keys.has(routine.id));
    if (routines.length === 0) continue;
    const plan = yield* reconcile(bound.calendar, routines, {
      nodes,
      list,
      now,
      origin: state.options.origin,
    });
    for (const event of plan.events)
      for (const write of event.writes) state.book.waits(write.target);
  }
});

export const makeRoutineEngine = Effect.fn("routines.engine.make")(function* (
  options: EngineOptions,
) {
  const state: State = {
    options,
    book: new StatusBook(),
    schedule: new Schedule(),
    lists: new Map(),
    released: new Map(),
  };
  const { book, schedule } = state;
  let revision = 0;
  let opened = false;
  let wanted = true;
  const firstPass = yield* Deferred.make<void>();
  const lock = yield* Semaphore.make(1);

  const pass = Effect.fn("routines.engine.pass")(function* () {
    const now = yield* Clock.currentTimeMillis;
    const due = schedule.dueAt(now);
    const planned = yield* listAndPlan(state, yield* options.host.read, now);
    holdEndings(state, planned);
    yield* sendEndings(state, planned, now);
    const named = new Set(planned.map(({ bound }) => "calendar:" + bound.calendar.id));
    for (const entry of planned)
      for (const event of entry.plan.events)
        for (const target of yield* sendEvent(state, entry, event, now))
          named.add(targetKey(target));
    // What no plan names any more has no status: an event gone, a day with nothing to send.
    book.prune(
      (target) =>
        named.has(targetKey(target)) ||
        (target.kind === "calendar" && schedule.has(target.calendar)),
    );
    schedule.settled(due, now);
    wanted = false;
  });
  const runPass = lock.withPermit(
    pass().pipe(
      Effect.ensuring(Deferred.succeed(firstPass, undefined)),
      Effect.andThen(Effect.suspend(() => book.publish())),
    ),
  );

  /** An edit: its events settle, and the writes it makes wait, as planned against the last list. */
  const tail = Effect.gen(function* () {
    const page = yield* options.host.changes(revision);
    const since = revision;
    revision = page.through;
    // What was written before the host started is the first pass's to send, at once.
    if (since === 0 && !opened) {
      opened = true;
      return;
    }
    if (page.changes.length === 0) return;
    const now = yield* Clock.currentTimeMillis;
    const nodes = yield* options.host.read;
    const keys = concerned(
      page.changes.flatMap((change) => change.ids),
      nodes,
    );
    for (const key of keys) schedule.edited(key, now);
    yield* markWaiting(state, nodes, keys, now);
    yield* book.publish();
  });

  const syncNow = Effect.sync(() => {
    schedule.now();
    wanted = true;
  });
  const release = Effect.fn("routines.engine.release")(function* (keys: readonly string[]) {
    for (const key of keys) {
      const ending = book.held.get(key);
      if (ending === undefined) return yield* new SyncError({ status: 400, code: "not_held" });
      state.released.set(key, ending);
    }
    wanted = true;
    return undefined;
  });
  const preview = Effect.gen(function* () {
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
  /** The statuses, once the first pass since the host started has run: never an empty memory's. */
  const status = Effect.fn("routines.engine.status")(function* () {
    yield* Deferred.await(firstPass);
    return book.snapshot();
  });
  /** Hear each new statuses value on `connection`, starting with the current one. */
  const watch = (connection: string, hear: (statuses: SyncStatuses) => Effect.Effect<void>) =>
    Effect.suspend(() => book.watch(connection, hear));
  const unwatch = (connection: string) => Effect.sync(() => book.unwatch(connection));
  const step = Effect.gen(function* () {
    yield* tail;
    if (wanted || schedule.ready(yield* Clock.currentTimeMillis)) yield* runPass;
  });
  const run = Effect.forkScoped(
    Effect.forever(
      step.pipe(
        Effect.orElseSucceed(() => undefined),
        Effect.andThen(Effect.sleep("1 second")),
      ),
    ),
  );
  return { step, pass: runPass, tail, syncNow, release, preview, status, watch, unwatch, run };
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
