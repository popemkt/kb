import { expect, test } from "bun:test";
import { Clock, Deferred, Fiber, DateTime, Effect, type Scope } from "effect";
import { TestClock } from "effect/testing";
import { SYSTEM_IDS, type NodeLike } from "@kb/model";
import {
  makeFakeCalendar,
  makeMemoryLedger,
  routineOption,
  ROUTINE_FIELDS as F,
  ROUTINE_TAGS as T,
  SyncError,
} from "@kb/routines";
import { makeRoutineEngine, type RoutineHost } from "../src/index.ts";

const at = DateTime.toEpochMillis(DateTime.makeUnsafe("2026-11-03T01:00:00Z"));
function node(
  id: string,
  tag: string,
  props: NodeLike["props"] = {},
  children: readonly string[] = [],
): NodeLike {
  return {
    id,
    text: id,
    children: [...children],
    props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: tag }], ...props },
  };
}
const str = (v: string) => [{ t: "str" as const, v }];
const ref = (v: string) => [{ t: "ref" as const, v }];
const fixture = Effect.gen(function* () {
  yield* TestClock.setTime(at);
  const fake = makeFakeCalendar(2);
  const calendar = yield* fake.port.create("kb routines", "Asia/Ho_Chi_Minh");
  const ledger = yield* makeMemoryLedger();
  let revision = 0;
  const edits: { at: number; ids: string[]; via: null; revision: number }[] = [];
  let trusted = true;
  const nodes = new Map<string, NodeLike>([
    [
      "account",
      node("account", T.account, {
        [F.email]: str("owner@example.test"),
        [F.clientId]: str("env:CLIENT"),
        [F.clientSecret]: str("env:SECRET"),
        [F.refreshToken]: str("dotenv:/tmp/fake#TOKEN"),
      }),
    ],
    [
      "calendar",
      node("calendar", T.calendar, {
        [F.account]: ref("account"),
        [F.calendarId]: str(calendar),
        [F.sync]: ref(routineOption("sync", "on")),
      }),
    ],
    [
      "routine",
      node("routine", T.routine, {
        [F.calendar]: ref("calendar"),
        [F.starts]: str("2026-11-03"),
        [F.at]: str("08:00"),
        [F.rrule]: str("FREQ=DAILY"),
      }),
    ],
  ]);
  const host: RoutineHost = {
    read: Effect.sync(() => new Map(nodes)),
    changes: (since) =>
      Effect.sync(() => ({
        head: revision,
        through: revision,
        complete: true,
        changes: edits.filter((edit) => edit.revision > since),
      })),
    trusted: () => Effect.sync(() => trusted),
    link: () => Effect.void,
    issue: () => Effect.void,
    attention: () => Effect.succeed("looking"),
  };
  let beforeWrite: Effect.Effect<void> = Effect.void;
  const engine = yield* makeRoutineEngine({
    host,
    ledger,
    client: () =>
      Effect.succeed({
        ...fake.port,
        write: (calendarId, changes) =>
          Effect.suspend(() =>
            beforeWrite.pipe(Effect.andThen(fake.port.write(calendarId, changes))),
          ),
      }),
    runner: "test",
    origin: "https://kb.test",
  });
  yield* engine.start;
  const edit = Effect.fn("test.edit")(function* (
    id: string,
    update: (current: NodeLike) => NodeLike | null,
  ) {
    const current = nodes.get(id);
    if (current === undefined) throw new Error("missing fixture node");
    const next = update(current);
    if (next === null) nodes.delete(id);
    else nodes.set(id, next);
    edits.push({ at: yield* Clock.currentTimeMillis, ids: [id], via: null, revision: ++revision });
    yield* engine.tail;
  });
  const flush = Effect.gen(function* () {
    yield* TestClock.adjust("6 seconds");
    yield* engine.push;
  });
  const root = Effect.gen(function* () {
    const units = yield* ledger.unit.byRoutine("routine");
    const unit = units.find((entry) => entry.kind !== "exception" && entry.state !== "ended");
    if (unit === undefined) throw new Error("missing root");
    return unit;
  });
  return {
    host,
    fake,
    ledger,
    calendar,
    nodes,
    engine,
    edit,
    flush,
    root,
    blockWrite: (effect: Effect.Effect<void>) => {
      beforeWrite = effect;
    },
    trust: (value: boolean) => {
      trusted = value;
    },
  };
});
function scenario(
  name: string,
  body: (f: Effect.Success<typeof fixture>) => Effect.Effect<void, SyncError, Scope.Scope>,
) {
  test(name, () =>
    Effect.runPromise(
      Effect.scoped(fixture.pipe(Effect.flatMap(body))).pipe(Effect.provide(TestClock.layer())),
    ),
  );
}
scenario(
  "quiet debounce, idempotency, echo and remote conflict with independent local edits",
  (f) =>
    Effect.gen(function* () {
      yield* f.engine.poll();
      yield* f.engine.push;
      expect(f.fake.snapshot(f.calendar)).toHaveLength(0);
      yield* f.flush;
      const unit = yield* f.root;
      expect(unit.state).toBe("synced");
      const first = yield* f.fake.port.get(f.calendar, unit.key);
      if (first.fields === null) throw new Error("missing fields");
      yield* f.fake.port.write(f.calendar, [
        {
          kind: "update",
          id: first.id,
          etag: first.etag,
          fields: { ...first.fields, title: "Google title" },
        },
      ]);
      yield* f.edit("routine", (current) => ({
        ...current,
        props: { ...current.props, [F.at]: str("09:00") },
      }));
      yield* f.flush;
      const remote = yield* f.fake.port.get(f.calendar, first.id);
      expect(remote.fields?.title).toBe("Google title");
      expect(remote.fields?.start.at).toBe("09:00");
      expect((yield* f.root).state).toBe("conflict");
      yield* f.engine.resolve(first.id);
      yield* f.flush;
      expect((yield* f.fake.port.get(f.calendar, first.id)).fields?.title).toBe("routine");
      const writes = f.fake.calls.filter((call) => call.method === "write").length;
      yield* f.flush;
      expect(f.fake.calls.filter((call) => call.method === "write")).toHaveLength(writes);
    }),
);
scenario("a response lost after commit is retried without duplication or false conflict", (f) =>
  Effect.gen(function* () {
    yield* f.engine.poll();
    f.fake.inject("write", "after", new SyncError({ status: 0, code: "offline" }));
    yield* f.flush;
    expect(f.fake.snapshot(f.calendar)).toHaveLength(1);
    expect((yield* f.root).pending).not.toBeNull();
    yield* TestClock.adjust("1 minute");
    yield* f.engine.push;
    expect(f.fake.snapshot(f.calendar)).toHaveLength(1);
    expect((yield* f.root).state).toBe("synced");
    expect((yield* f.root).pending).toBeNull();
  }),
);
scenario("deleted Google events need explicit recreation with a new generation", (f) =>
  Effect.gen(function* () {
    yield* f.engine.poll();
    yield* f.flush;
    const root = yield* f.root;
    const event = yield* f.fake.port.get(f.calendar, root.key);
    yield* f.fake.port.write(f.calendar, [{ kind: "remove", id: event.id, etag: event.etag }]);
    yield* f.engine.poll(true);
    yield* f.flush;
    expect((yield* f.root).state).toBe("deleted");
    yield* f.engine.syncNow();
    yield* f.flush;
    expect((yield* f.root).state).toBe("deleted");
    yield* f.engine.recreate(root.key);
    yield* f.flush;
    expect((yield* f.root).generation).toBe(1);
    expect((yield* f.root).key).not.toBe(root.key);
  }),
);
scenario("pause and trust revocation stop requests; held deletes require the exact release", (f) =>
  Effect.gen(function* () {
    f.trust(false);
    yield* f.engine.poll();
    yield* f.flush;
    expect(f.fake.calls.filter((call) => call.method !== "create")).toHaveLength(0);
    f.trust(true);
    yield* f.engine.poll(true);
    yield* f.flush;
    const root = yield* f.root;
    yield* f.edit("routine", () => null);
    yield* f.flush;
    expect((yield* f.ledger.unit.get(root.key))?.state).toBe("held");
    yield* f.engine.release([root.key]);
    yield* f.flush;
    expect((yield* f.ledger.unit.get(root.key))?.state).toBe("ended");
    expect((yield* f.fake.port.get(f.calendar, root.key)).fields?.recurrence[0]).toContain(
      "UNTIL=20261102T165959Z",
    );
    yield* f.edit("calendar", (current) => ({
      ...current,
      props: { ...current.props, [F.sync]: ref(routineOption("sync", "paused")) },
    }));
    const calls = f.fake.calls.length;
    yield* f.engine.poll(true);
    yield* f.flush;
    expect(f.fake.calls).toHaveLength(calls);
  }),
);
scenario("sparse done, skip, move and removed facts use original instance identity", (f) =>
  Effect.gen(function* () {
    f.nodes.set(
      "done",
      node("done", T.occurrence, {
        [F.on]: str("2026-11-03"),
        [F.state]: ref(routineOption("state", "done")),
      }),
    );
    yield* f.edit("routine", (current) => ({ ...current, children: ["done"] }));
    yield* f.engine.poll();
    yield* f.flush;
    yield* f.flush;
    const instance = f.fake.snapshot(f.calendar).find((event) => event.seriesId !== null);
    expect(instance?.fields?.done).toBe(true);
    const id = instance?.id;
    yield* f.edit("done", (current) => ({
      ...current,
      props: {
        ...current.props,
        [F.state]: ref(routineOption("state", "moved")),
        [F.movedTo]: str("2026-11-05"),
      },
    }));
    yield* f.flush;
    yield* f.flush;
    const moved = f.fake.snapshot(f.calendar).find((event) => event.id === id);
    expect(moved?.originalStart?.day).toBe("2026-11-03");
    expect(moved?.fields?.start.day).toBe("2026-11-05");
    yield* f.edit("routine", (current) => ({ ...current, children: [] }));
    yield* f.flush;
    yield* f.flush;
    expect(f.fake.snapshot(f.calendar).find((event) => event.id === id)?.fields?.start.day).toBe(
      "2026-11-03",
    );
  }),
);
scenario(
  "tailing remains responsive during a slow write and a later edit is not acknowledged",
  (f) =>
    Effect.gen(function* () {
      yield* f.engine.poll();
      yield* TestClock.adjust("6 seconds");
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      f.blockWrite(
        Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
      );
      const pushing = yield* Effect.forkScoped(f.engine.push);
      yield* Deferred.await(entered);
      yield* f.edit("routine", (current) => ({ ...current, text: "Edited during request" }));
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(pushing);
      expect((yield* f.root).state).toBe("dirty");
      f.blockWrite(Effect.void);
      yield* f.flush;
      expect((yield* f.fake.port.get(f.calendar, (yield* f.root).key)).fields?.title).toBe(
        "Edited during request",
      );
      expect((yield* f.root).state).toBe("synced");
    }),
);
scenario("412 re-reads the remote head and reports a conflict without overwriting it", (f) =>
  Effect.gen(function* () {
    yield* f.engine.poll();
    yield* f.flush;
    const root = yield* f.root;
    yield* f.edit("routine", (current) => ({ ...current, text: "Local edit" }));
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    f.blockWrite(
      Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
    );
    yield* TestClock.adjust("6 seconds");
    const pushing = yield* Effect.forkScoped(f.engine.push);
    yield* Deferred.await(entered);
    const event = yield* f.fake.port.get(f.calendar, root.key);
    if (event.fields === null) throw new Error("missing fields");
    yield* f.fake.port.write(f.calendar, [
      {
        kind: "update",
        id: event.id,
        etag: event.etag,
        fields: { ...event.fields, title: "Concurrent Google edit" },
      },
    ]);
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(pushing);
    f.blockWrite(Effect.void);
    yield* f.flush;
    expect((yield* f.fake.port.get(f.calendar, root.key)).fields?.title).toBe(
      "Concurrent Google edit",
    );
    expect((yield* f.root).state).toBe("conflict");
  }),
);
scenario("successful polls preserve write exhaustion; explicit retry and edits recover", (f) =>
  Effect.gen(function* () {
    yield* f.engine.poll();
    for (let index = 0; index < 10; index++) {
      f.fake.inject("write", "before", new SyncError({ status: 503, code: "write_unavailable" }));
      yield* TestClock.adjust("16 minutes");
      yield* f.engine.push;
    }
    expect((yield* f.root).attempts).toBe(10);
    expect((yield* f.root).state).toBe("failed");
    yield* f.engine.poll(true);
    yield* f.flush;
    expect((yield* f.root).state).toBe("failed");
    expect((yield* f.root).attempts).toBe(10);
    yield* f.engine.syncNow();
    yield* f.flush;
    expect((yield* f.root).state).toBe("synced");
    yield* f.edit("routine", (current) => ({ ...current, text: "needs auth" }));
    f.fake.inject("get", "before", new SyncError({ status: 401, code: "auth_needed" }));
    yield* f.flush;
    const calls = f.fake.calls.length;
    yield* f.engine.poll(true);
    yield* f.flush;
    expect(f.fake.calls).toHaveLength(calls);
  }),
);
scenario("410 rebuilds sync state; intermediate pages block outbound writes", (f) =>
  Effect.gen(function* () {
    yield* f.engine.poll();
    yield* f.flush;
    for (let index = 0; index < 3; index++) {
      const original = f.nodes.get("routine");
      if (original === undefined) throw new Error("missing routine");
      const id = "routine-" + index;
      f.nodes.set(id, { ...original, id });
    }
    yield* f.edit("routine", (current) => ({ ...current, text: "changed" }));
    yield* TestClock.adjust("6 seconds");
    yield* f.engine.push;
    f.fake.expireTokens();
    yield* f.engine.poll(true);
    expect(yield* f.ledger.cursor.get("token:calendar")).toBe("");
    yield* f.engine.poll(true);
    const writes = f.fake.calls.filter((call) => call.method === "write").length;
    yield* f.engine.push;
    expect(f.fake.calls.filter((call) => call.method === "write")).toHaveLength(writes);
    yield* f.engine.poll(true);
    yield* f.engine.push;
    expect(yield* f.ledger.cursor.get("scan:calendar")).toBe("");
  }),
);
scenario("a six-series deletion batch is held as a group", (f) =>
  Effect.gen(function* () {
    for (let index = 0; index < 5; index++) {
      const original = f.nodes.get("routine");
      if (original === undefined) throw new Error("missing routine");
      const id = "extra-" + index;
      f.nodes.set(id, { ...original, id });
    }
    yield* f.edit("routine", (current) => ({ ...current, text: "batch" }));
    yield* f.engine.poll();
    yield* f.flush;
    expect(f.fake.snapshot(f.calendar)).toHaveLength(6);
    for (const id of ["routine", ...Array.from({ length: 5 }, (_, index) => "extra-" + index)])
      yield* f.edit(id, () => null);
    yield* TestClock.adjust("30 seconds");
    yield* f.engine.push;
    const units = yield* f.ledger.unit.all("calendar");
    expect(units.filter((unit) => unit.state === "held")).toHaveLength(6);
    expect(
      f.fake
        .snapshot(f.calendar)
        .every((event) => event.fields?.recurrence[0]?.includes("UNTIL=") !== true),
    ).toBe(true);
  }),
);
scenario("quota Retry-After pauses all requests for the account and then catches up", (f) =>
  Effect.gen(function* () {
    yield* f.engine.poll();
    f.fake.inject(
      "get",
      "before",
      new SyncError({ status: 429, code: "quota", retryAfter: 120_000 }),
    );
    yield* f.flush;
    const calls = f.fake.calls.length;
    yield* TestClock.adjust("1 minute");
    yield* f.engine.poll(true);
    yield* f.engine.push;
    expect(f.fake.calls).toHaveLength(calls);
    yield* TestClock.adjust("2 minutes");
    yield* f.engine.push;
    expect((yield* f.root).state).toBe("synced");
  }),
);
scenario("the focused poll cadence is twenty seconds, independently of outbound settling", (f) =>
  Effect.gen(function* () {
    yield* f.engine.poll();
    yield* f.flush;
    const lists = f.fake.calls.filter((call) => call.method === "list").length;
    yield* f.engine.poll();
    expect(f.fake.calls.filter((call) => call.method === "list")).toHaveLength(lists);
    yield* TestClock.adjust("14 seconds");
    yield* f.engine.poll();
    expect(f.fake.calls.filter((call) => call.method === "list")).toHaveLength(lists + 1);
  }),
);
scenario(
  "rebuilding an empty ledger finds the latest deterministic generation and ignores copied metadata",
  (f) =>
    Effect.gen(function* () {
      yield* f.engine.poll();
      yield* f.flush;
      const old = yield* f.root;
      const event = yield* f.fake.port.get(f.calendar, old.key);
      yield* f.fake.port.write(f.calendar, [{ kind: "remove", id: event.id, etag: event.etag }]);
      yield* f.engine.poll(true);
      yield* f.flush;
      yield* f.engine.recreate(old.key);
      yield* f.flush;
      const latest = yield* f.fake.port.get(f.calendar, (yield* f.root).key);
      if (latest.fields === null) throw new Error("missing fields");
      yield* f.fake.port.write(f.calendar, [
        { kind: "insert", id: "kb000099", fields: latest.fields },
      ]);
      const ledger = yield* makeMemoryLedger();
      const rebuilt = yield* makeRoutineEngine({
        host: f.host,
        ledger,
        client: () => Effect.succeed(f.fake.port),
        runner: "restarted",
        origin: "https://kb.test",
      });
      yield* rebuilt.start;
      yield* rebuilt.poll(true);
      yield* rebuilt.poll(true);
      const writes = f.fake.calls.filter((call) => call.method === "write").length;
      yield* TestClock.adjust("6 seconds");
      yield* rebuilt.push;
      const active = (yield* ledger.unit.byRoutine("routine")).filter(
        (unit) => unit.state !== "ended",
      );
      expect(active).toHaveLength(1);
      expect(active[0]?.generation).toBe(1);
      expect(active[0]?.state).toBe("synced");
      expect(yield* ledger.unit.get("kb000099")).toBeNull();
      expect(f.fake.calls.filter((call) => call.method === "write")).toHaveLength(writes);
    }),
);
scenario("a slow request renews its lease and is interrupted when trust is revoked", (f) =>
  Effect.gen(function* () {
    yield* f.engine.poll();
    yield* TestClock.adjust("6 seconds");
    const entered = yield* Deferred.make<void>();
    f.blockWrite(Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)));
    const pushing = yield* Effect.forkScoped(f.engine.push);
    yield* Deferred.await(entered);
    yield* TestClock.adjust("2 minutes");
    expect(
      yield* f.ledger.lease.acquire("calendar:calendar", "other-runner", at + 126_000, 60_000),
    ).toBe(false);
    f.trust(false);
    yield* TestClock.adjust("20 seconds");
    yield* Fiber.join(pushing);
    expect(f.fake.snapshot(f.calendar)).toHaveLength(0);
  }),
);
scenario(
  "removing our skip restores an instance; Google cancellation still needs explicit resolution",
  (f) =>
    Effect.gen(function* () {
      f.nodes.set(
        "skip",
        node("skip", T.occurrence, {
          [F.on]: str("2026-11-03"),
          [F.state]: ref(routineOption("state", "skipped")),
        }),
      );
      yield* f.edit("routine", (current) => ({ ...current, children: ["skip"] }));
      yield* f.engine.poll();
      yield* f.flush;
      yield* f.flush;
      const instance = f.fake.snapshot(f.calendar).find((event) => event.seriesId !== null);
      if (instance === undefined || instance.fields === null) throw new Error("missing instance");
      expect(instance.deleted).toBe(true);
      yield* f.edit("routine", (current) => ({ ...current, children: [] }));
      yield* f.flush;
      yield* f.flush;
      const restored = yield* f.fake.port.get(f.calendar, instance.id);
      expect(restored.deleted).toBe(false);
      if (restored.fields === null) throw new Error("missing fields");
      yield* f.fake.port.write(f.calendar, [
        {
          kind: "update",
          id: restored.id,
          etag: restored.etag,
          fields: { ...restored.fields, status: "cancelled" },
        },
      ]);
      yield* f.engine.poll(true);
      yield* f.flush;
      expect((yield* f.ledger.unit.get(instance.id))?.state).toBe("deleted");
      yield* f.engine.resolve(instance.id);
      yield* f.flush;
      expect((yield* f.fake.port.get(f.calendar, instance.id)).deleted).toBe(false);
    }),
);
scenario("daily reconciliation applies facts as they enter the rolling exception window", (f) =>
  Effect.gen(function* () {
    f.nodes.set(
      "future",
      node("future", T.occurrence, {
        [F.on]: str("2027-12-09"),
        [F.state]: ref(routineOption("state", "done")),
      }),
    );
    yield* f.edit("routine", (current) => ({ ...current, children: ["future"] }));
    yield* f.engine.poll();
    yield* f.flush;
    expect(f.fake.snapshot(f.calendar)).toHaveLength(1);
    yield* TestClock.adjust("2 days");
    yield* f.engine.poll(true);
    yield* f.flush;
    yield* f.flush;
    expect(
      f.fake.snapshot(f.calendar).find((event) => event.originalStart?.day === "2027-12-09")?.fields
        ?.done,
    ).toBe(true);
  }),
);
scenario("edits during a max-wait flush begin a fresh settling window", (f) =>
  Effect.gen(function* () {
    yield* f.engine.poll();
    yield* TestClock.adjust("31 seconds");
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    f.blockWrite(
      Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
    );
    const pushing = yield* Effect.forkScoped(f.engine.push);
    yield* Deferred.await(entered);
    for (let index = 0; index < 5; index++) {
      yield* TestClock.adjust("1 second");
      yield* f.edit("routine", (current) => ({ ...current, text: "in flight " + index }));
    }
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(pushing);
    f.blockWrite(Effect.void);
    const writes = f.fake.calls.filter((call) => call.method === "write").length;
    yield* f.engine.push;
    expect(f.fake.calls.filter((call) => call.method === "write")).toHaveLength(writes);
    yield* TestClock.adjust("5 seconds");
    yield* f.engine.push;
    expect(f.fake.calls.filter((call) => call.method === "write")).toHaveLength(writes + 1);
  }),
);
scenario("a routine timezone override owns the deletion day even across calendar midnight", (f) =>
  Effect.gen(function* () {
    yield* f.edit("routine", (current) => ({
      ...current,
      props: {
        ...current.props,
        [F.timezone]: str("America/New_York"),
        [F.starts]: str("2026-11-01"),
      },
    }));
    yield* f.engine.poll();
    yield* f.flush;
    const root = yield* f.root;
    yield* f.edit("routine", () => null);
    yield* f.flush;
    yield* f.engine.release([root.key]);
    yield* f.flush;
    expect((yield* f.fake.port.get(f.calendar, root.key)).fields?.recurrence[0]).toContain(
      "UNTIL=20261102T045959Z",
    );
  }),
);

scenario("a sustained backlog progresses at the production one-second cadence", (f) =>
  Effect.gen(function* () {
    const original = f.nodes.get("routine");
    if (original === undefined) throw new Error("missing routine");
    for (let index = 0; index < 29; index++) {
      const id = "backlog-" + index;
      f.nodes.set(id, { ...original, id });
    }
    yield* f.edit("routine", (current) => ({ ...current, text: "backlog" }));
    yield* f.engine.poll();
    yield* TestClock.adjust("6 seconds");
    for (let tick = 0; tick < 20; tick++) {
      yield* f.engine.push;
      yield* TestClock.adjust("1 second");
    }
    expect(f.fake.snapshot(f.calendar)).toHaveLength(30);
  }),
);
scenario("six removals behind 98 harmless changes are held before pagination and admission", (f) =>
  Effect.gen(function* () {
    yield* f.engine.poll();
    yield* f.flush;
    const root = yield* f.root;
    const event = yield* f.fake.port.get(f.calendar, root.key);
    if (event.fields === null) throw new Error("missing fields");
    for (let index = 0; index < 104; index++) {
      const key = "guard" + index.toString().padStart(4, "0");
      const routineId = "missing-" + index;
      const fields = { ...event.fields, nodeId: index < 98 ? "routine" : routineId };
      yield* f.fake.port.write(f.calendar, [{ kind: "insert", id: key, fields }]);
      yield* f.ledger.unit.put(
        {
          ...root,
          key,
          routineId,
          base: fields,
          state: "dirty",
          nextAttemptAt: 0,
          version: 0,
          // The first 98 project harmlessly to existing nodes.
          ...(index < 98 ? { routineId: "routine", base: event.fields } : {}),
        },
        0,
      );
    }
    yield* TestClock.adjust("6 seconds");
    yield* f.engine.push;
    const units = yield* f.ledger.unit.all("calendar");
    expect(units.filter((unit) => unit.state === "held")).toHaveLength(6);
    expect(
      f.fake
        .snapshot(f.calendar)
        .filter(
          (entry) => entry.fields?.recurrence.some((rule) => rule.includes("UNTIL=")) === true,
        ),
    ).toHaveLength(0);
  }),
);

scenario("editing a still-exhausted unit resets its write budget", (f) =>
  Effect.gen(function* () {
    yield* f.engine.poll();
    for (let index = 0; index < 10; index++) {
      f.fake.inject("write", "before", new SyncError({ status: 503, code: "unavailable" }));
      yield* TestClock.adjust("16 minutes");
      yield* f.engine.push;
    }
    expect((yield* f.root).state).toBe("failed");
    expect((yield* f.root).attempts).toBe(10);
    yield* f.edit("routine", (current) => ({ ...current, text: "changed while failed" }));
    expect((yield* f.root).state).toBe("dirty");
    expect((yield* f.root).attempts).toBe(0);
    yield* f.flush;
    expect((yield* f.root).state).toBe("synced");
  }),
);
for (const probeFails of [false, true])
  scenario("recorded offline recovery grants one backed-off probe; failure=" + probeFails, (f) =>
    Effect.gen(function* () {
      yield* f.engine.poll();
      for (let index = 0; index < 10; index++) {
        f.fake.inject("write", "before", new SyncError({ status: 0, code: "offline" }));
        yield* TestClock.adjust("16 minutes");
        yield* f.engine.push;
      }
      expect((yield* f.root).state).toBe("failed");
      f.fake.inject("list", "before", new SyncError({ status: 0, code: "offline" }));
      yield* f.engine.poll(true);
      yield* f.engine.poll(true);
      const probing = yield* f.root;
      expect(probing.state).toBe("retry");
      expect(probing.attempts).toBe(10);
      expect(probing.nextAttemptAt).toBeGreaterThan(yield* Clock.currentTimeMillis);
      yield* f.engine.poll(true);
      expect((yield* f.root).nextAttemptAt).toBe(probing.nextAttemptAt);
      if (probeFails)
        f.fake.inject("write", "before", new SyncError({ status: 0, code: "offline" }));
      yield* TestClock.adjust("16 minutes");
      yield* f.engine.push;
      expect((yield* f.root).state).toBe(probeFails ? "failed" : "synced");
      if (probeFails) {
        expect((yield* f.root).attempts).toBe(11);
        yield* f.engine.poll(true);
        yield* f.flush;
        expect((yield* f.root).state).toBe("failed");
        expect((yield* f.root).attempts).toBe(11);
      }
    }),
  );
