import { expect, test } from "bun:test";
import { Effect, type Scope } from "effect";
import { TestClock } from "effect/testing";
import { SYSTEM_IDS, type NodeLike } from "@kb/model";
import {
  makeFakeCalendar,
  routineOption,
  ROUTINE_FIELDS as F,
  ROUTINE_TAGS as T,
  SyncError,
  type SyncStatus,
} from "@kb/routines";
import { makeRoutineEngine } from "../src/index.ts";
const str = (v: string) => [{ t: "str" as const, v }];
const ref = (v: string) => [{ t: "ref" as const, v }];
function node(id: string, tag: string, props: NodeLike["props"]): NodeLike {
  return { id, text: id, children: [], props: { [SYSTEM_IDS.typeField]: ref(tag), ...props } };
}
const fixture = Effect.gen(function* () {
  yield* TestClock.setTime(1793667600000);
  const fake = makeFakeCalendar();
  const nodes = new Map<string, NodeLike>([
    [
      "calendar",
      node("calendar", T.calendar, {
        [F.calendarId]: str("google"),
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
  let writes = 0;
  let calls = 0;
  let failures = 0;
  const statuses = new Map<string, SyncStatus>();
  const engine = yield* makeRoutineEngine({
    origin: "https://kb.test",
    runner: "test",
    host: {
      read: Effect.sync(() => new Map(nodes)),
      changes: () =>
        Effect.succeed({
          head: 1,
          through: 1,
          complete: true,
          changes: [{ at: 0, ids: ["routine"], via: null }],
        }),
      trusted: () => Effect.succeed(true),
      status: (id, status) =>
        Effect.sync(() => {
          if (JSON.stringify(statuses.get(id)) !== JSON.stringify(status)) writes++;
          statuses.set(id, status);
        }),
    },
    client: () =>
      Effect.succeed({
        ...fake.port,
        put: (calendar, id, fields) =>
          Effect.suspend(() => {
            calls++;
            if (failures-- > 0)
              return Effect.fail(new SyncError({ status: 503, code: "unavailable" }));
            return fake.port.put(calendar, id, fields);
          }),
      }),
  });
  yield* engine.start;
  return {
    engine,
    nodes,
    fake,
    statuses,
    writes: () => writes,
    calls: () => calls,
    fail: (count: number) => {
      failures = count;
    },
    flush: TestClock.adjust("6 seconds").pipe(Effect.andThen(engine.push)),
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
scenario("quiet debounce, node response fields, and no-op syncs", (f) =>
  Effect.gen(function* () {
    yield* f.engine.push;
    expect(f.calls()).toBe(0);
    yield* f.flush;
    expect(f.statuses.get("routine")).toMatchObject({
      state: "synced",
      eventId: expect.stringMatching(/^kb/),
      url: expect.stringContaining("calendar.test"),
    });
    const writes = f.writes();
    yield* f.engine.tail;
    yield* f.engine.syncNow();
    yield* f.flush;
    expect(f.calls()).toBe(1);
    expect(f.writes()).toBe(writes);
  }),
);
scenario("continuous edits flush at thirty seconds", (f) =>
  Effect.gen(function* () {
    for (let index = 0; index < 7; index++) {
      yield* TestClock.adjust("4 seconds");
      const current = f.nodes.get("routine");
      if (current === undefined) throw new Error("missing routine");
      f.nodes.set(current.id, { ...current, text: "edit-" + index });
      yield* f.engine.tail;
      yield* f.engine.push;
    }
    expect(f.calls()).toBe(0);
    yield* TestClock.adjust("2 seconds");
    yield* f.engine.push;
    expect(f.calls()).toBe(1);
  }),
);
scenario("plain retry stops at ten; Sync now and changed inputs retry", (f) =>
  Effect.gen(function* () {
    f.fail(10);
    for (let attempt = 0; attempt < 10; attempt++) {
      yield* TestClock.adjust("16 minutes");
      yield* f.engine.push;
    }
    expect(f.calls()).toBe(10);
    yield* f.flush;
    expect(f.calls()).toBe(10);
    expect(f.statuses.get("routine")?.state).toBe("error");
    yield* f.engine.syncNow();
    yield* f.flush;
    expect(f.statuses.get("routine")?.state).toBe("synced");
  }),
);
scenario("done and skipped occurrence nodes push opaque instance IDs", (f) =>
  Effect.gen(function* () {
    const parent = f.nodes.get("routine");
    if (parent === undefined) throw new Error("missing routine");
    f.nodes.set(parent.id, { ...parent, children: ["done", "skip"] });
    f.nodes.set(
      "done",
      node("done", T.occurrence, {
        [F.on]: str("2026-11-03"),
        [F.state]: ref(routineOption("state", "done")),
      }),
    );
    f.nodes.set(
      "skip",
      node("skip", T.occurrence, {
        [F.on]: str("2026-11-04"),
        [F.state]: ref(routineOption("state", "skipped")),
      }),
    );
    yield* f.engine.tail;
    yield* f.flush;
    expect(f.statuses.get("done")?.eventId).toContain("_2026-11-03");
    expect([...f.fake.events.values()].some((fields) => fields.done)).toBe(true);
    expect([...f.fake.events.values()].some((fields) => fields.status === "cancelled")).toBe(true);
  }),
);
scenario("six series removals are held before any writes and explicit release ends them", (f) =>
  Effect.gen(function* () {
    const original = f.nodes.get("routine");
    if (original === undefined) throw new Error("missing routine");
    for (let index = 0; index < 5; index++)
      f.nodes.set("extra-" + index, { ...original, id: "extra-" + index });
    yield* f.engine.tail;
    yield* f.flush;
    expect(f.calls()).toBe(6);
    const ids = [...f.nodes.keys()].filter((id) => id !== "calendar");
    for (const id of ids) f.nodes.delete(id);
    yield* f.engine.tail;
    yield* f.flush;
    expect(f.calls()).toBe(6);
    yield* f.engine.release(ids);
    yield* f.engine.push;
    expect(f.calls()).toBe(12);
    expect(
      [...f.fake.events.values()].every(
        (fields) => fields.recurrence[0]?.includes("UNTIL=") === true,
      ),
    ).toBe(true);
  }),
);
