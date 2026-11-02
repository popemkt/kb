import { Semaphore, Result, Clock, Effect } from "effect";
import { firstRef, typeRefsOf, type NodeLike } from "@kb/model";
import {
  readAccount,
  readCalendar,
  RequestBucket,
  ROUTINE_FIELDS as F,
  ROUTINE_TAGS as T,
  type CalendarBinding,
  type CalendarPort,
  type SyncLedger,
  type SyncError,
} from "@kb/routines";
import { calendarBindingDigest } from "./binding.ts";
import type { RoutineHost } from "./graph.ts";
import { SyncQueue, type Touch } from "./queue.ts";
import { CalendarSession, type AccountLimiter } from "./session.ts";

export interface EngineOptions {
  readonly host: RoutineHost;
  readonly ledger: SyncLedger;
  readonly client: (binding: CalendarBinding) => Effect.Effect<CalendarPort, SyncError>;
  readonly runner: string;
  readonly origin: string;
}
// GAP [[01M6EKEE8P040W6592ZZ3HDVGC]] Placement uses binding trust and a lease until another family needs a runner contract.
export class EngineContext {
  private readonly refreshLock = Semaphore.makeUnsafe(1);
  readonly options: EngineOptions;
  readonly queue: SyncQueue;
  nodes: ReadonlyMap<string, NodeLike> = new Map();
  readonly sessions = new Map<string, { digest: string; session: CalendarSession }>();
  readonly limiters = new Map<string, AccountLimiter>();
  revision = 0;
  constructor(options: EngineOptions) {
    this.options = options;
    this.queue = new SyncQueue(options.ledger);
  }
  readonly refresh = (touch: Touch) => this.refreshLock.withPermit(this.refreshSnapshot(touch));
  private readonly refreshSnapshot = Effect.fn("routines.context.refresh")(function* (
    this: EngineContext,
    touch: Touch,
  ) {
    this.nodes = yield* this.options.host.read;
    const wanted = new Set<string>();
    for (const node of this.nodes.values()) {
      if (!typeRefsOf(node).includes(T.calendar)) continue;
      const decoded = yield* Effect.result(
        Effect.try({
          try: () => {
            const calendar = readCalendar(node);
            const accountNode = this.nodes.get(calendar.account);
            return {
              calendar,
              account: accountNode === undefined ? null : readAccount(accountNode),
            };
          },
          catch: () => null,
        }),
      );
      if (Result.isFailure(decoded)) continue;
      const binding = decoded.success;
      const { calendar, account } = binding;
      if (calendar.mode !== "on" || calendar.calendarId === "" || account === null) continue;
      wanted.add(calendar.id);
      const digest = yield* calendarBindingDigest(binding);
      const previous = this.sessions.get(calendar.id);
      if (previous?.digest === digest) continue;
      if (previous !== undefined) yield* previous.session.close();
      if ((yield* this.options.ledger.cursor.get("binding:" + calendar.id)) !== digest) {
        for (const key of ["initialized:", "token:", "scan:", "full:"])
          yield* this.options.ledger.cursor.set(key + calendar.id, "");
        yield* this.options.ledger.cursor.set("binding:" + calendar.id, digest);
      }
      const key = account.id;
      const limiter = this.limiters.get(key) ?? { bucket: new RequestBucket(), pauseUntil: 0 };
      this.limiters.set(key, limiter);
      this.sessions.set(calendar.id, {
        digest,
        session: new CalendarSession({
          binding,
          digest,
          limiter,
          client: yield* this.options.client(binding),
          host: this.options.host,
          ledger: this.options.ledger,
          holder: this.options.runner,
        }),
      });
    }
    for (const [id, entry] of this.sessions)
      if (!wanted.has(id)) {
        yield* entry.session.close();
        this.sessions.delete(id);
      }
    for (const { session } of this.sessions.values()) {
      const routines = new Set(
        (yield* this.options.ledger.unit.all(session.binding.calendar.id)).map(
          (unit) => unit.routineId,
        ),
      );
      for (const node of this.nodes.values())
        if (
          typeRefsOf(node).includes(T.routine) &&
          firstRef(F.calendar)(node.props) === session.binding.calendar.id
        )
          routines.add(node.id);
      for (const id of routines) yield* this.queue.touch(id, session.binding, this.nodes, touch);
    }
  });
  readonly start = Effect.fn("routines.context.start")(function* (this: EngineContext) {
    const saved = yield* this.options.ledger.cursor.get("kb.tail");
    this.revision = saved === null ? (yield* this.options.host.changes(0)).head : Number(saved);
    yield* this.refresh({
      kind: "startup",
      at: yield* Clock.currentTimeMillis,
      revision: this.revision,
    });
  });
  readonly tail = Effect.fn("routines.context.tail")(function* (this: EngineContext) {
    const page = yield* this.options.host.changes(this.revision);
    if (page.changes.length !== 0)
      yield* this.refresh({
        kind: "change",
        at: Math.max(...page.changes.map((change) => change.at)),
        revision: page.through,
      });
    this.revision = page.through;
    yield* this.options.ledger.cursor.set("kb.tail", String(page.through));
  });
  readonly close = Effect.fn("routines.context.close")(function* (this: EngineContext) {
    for (const { session } of this.sessions.values()) yield* session.close();
  });
}
