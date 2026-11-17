import { expect, test } from "bun:test";
import { Effect, type Scope } from "effect";
import { TestClock } from "effect/testing";
import { SYSTEM_IDS, type NodeLike } from "@kb/model";
import {
  makeFakeCalendar,
  readCalendar,
  readSyncStatus,
  routineOption,
  syncStatusProps,
  ROUTINE_FIELDS as F,
  ROUTINE_TAGS as T,
  SyncError,
  type EventFields,
} from "@kb/routines";
import { makeRoutineEngine } from "../src/index.ts";
import { calendarBindingDigest } from "../src/binding.ts";
import type { TailChange } from "../src/graph.ts";
const str = (v: string) => [{ t: "str" as const, v }];
const ref = (v: string) => [{ t: "ref" as const, v }];
function node(id: string, tag: string, props: NodeLike["props"]): NodeLike {
  return { id, text: id, children: [], props: { [SYSTEM_IDS.typeField]: ref(tag), ...props } };
}
const calendarNode = (id: string, google: string, sync: "on" | "paused" = "on") =>
  node(id, T.calendar, {
    [F.calendarId]: str(google),
    [F.sync]: ref(routineOption("sync", sync)),
  });
const routineNode = (id: string, calendar = "calendar") =>
  node(id, T.routine, {
    [F.calendar]: ref(calendar),
    [F.starts]: str("2026-11-03"),
    [F.at]: str("08:00"),
    [F.rrule]: str("FREQ=DAILY"),
  });

/** One store, one calendar in memory, and a way to start a host over them as often as a test restarts it. */
function world(fake = makeFakeCalendar()) {
  const nodes = new Map<string, NodeLike>([
    ["calendar", calendarNode("calendar", "google")],
    ["routine", routineNode("routine")],
  ]);
  /** What each change wrote of calendars, as the store's history answers it. */
  const written = (ids: readonly string[]) =>
    ids.flatMap((id) => {
      const held = nodes.get(id);
      if (held === undefined || held.props[SYSTEM_IDS.typeField]?.[0]?.v !== T.calendar) return [];
      return [readCalendar(held)];
    });
  // The store's history holds the calendar as it was written.
  const changes: TailChange[] = [{ at: 0, ids: ["calendar", "routine"], via: null, calendars: [] }];
  changes[0] = { ...changes[0], calendars: written(["calendar"]) } as TailChange;
  const counts = { puts: 0, lists: 0, statuses: 0 };
  let failing: { count: number; which: (id: string) => boolean } = { count: 0, which: () => true };
  /** The binding digests a person no longer trusts. */
  const distrusted = new Set<string>();
  /** How many list calls fail next. */
  let listFailures = 0;
  const host = () =>
    makeRoutineEngine({
      origin: "https://kb.test",
      runner: "test",
      host: {
        read: Effect.sync(() => new Map(nodes)),
        changes: (since) =>
          Effect.sync(() => ({
            head: changes.length,
            through: changes.length,
            complete: true,
            changes: changes.slice(since),
          })),
        trusted: (digest) => Effect.succeed(!distrusted.has(digest)),
        // Sync's own writes, which the change feed leaves out.
        status: (id, status) =>
          Effect.sync(() => {
            const held = nodes.get(id);
            if (held === undefined) return;
            counts.statuses++;
            const props = { ...held.props };
            for (const [field, value] of Object.entries(syncStatusProps(status)))
              if (value === null) delete props[field];
              else props[field] = [value];
            nodes.set(id, { ...held, props });
          }),
      },
      client: () =>
        Effect.succeed({
          ...fake.port,
          list: (calendar) =>
            Effect.suspend(() => {
              counts.lists++;
              if (listFailures-- > 0)
                return Effect.fail(new SyncError({ status: 503, code: "unavailable" }));
              return fake.port.list(calendar);
            }),
          put: (calendar, id, fields) =>
            Effect.suspend(() => {
              counts.puts++;
              if (failing.which(id) && failing.count-- > 0)
                return Effect.fail(new SyncError({ status: 503, code: "unavailable" }));
              return fake.port.put(calendar, id, fields);
            }),
        }),
    });
  return {
    fake,
    nodes,
    counts,
    distrusted,
    host,
    /** A person's edit: what it wrote, as the store's change feed says it. */
    touch: (...ids: string[]) =>
      void changes.push({ at: 0, ids, via: null, calendars: written(ids) }),
    fail: (count: number, which: (id: string) => boolean = () => true) => {
      failing = { count, which };
    },
    failLists: (count: number) => {
      listFailures = count;
    },
  };
}
type World = ReturnType<typeof world>;
type Engine = Effect.Success<ReturnType<World["host"]>>;
/** A started host: its first pass run, as a host's start runs it. */
const start = Effect.fn(function* (w: World) {
  const engine = yield* w.host();
  yield* engine.step;
  return engine;
});
/** Let an edit settle, then run what falls due. */
const flush = (engine: Engine) =>
  engine.tail.pipe(Effect.andThen(TestClock.adjust("6 seconds")), Effect.andThen(engine.step));
/** The status a node's sync fields hold, as the page reads it. */
const stored = (w: World, id: string) => {
  const held = w.nodes.get(id);
  return held === undefined ? null : readSyncStatus(held);
};
/** The status on the routine's fact for `day`. */
const onDay = (w: World, day: string) => stored(w, "fact-routine-" + day);
const event = (w: World, suffix: string): EventFields | undefined =>
  [...w.fake.events].find(([key]) => key.endsWith(suffix))?.[1];
/** The routine with one fact on `on`, as ticking that instance writes it. */
function fact(w: World, on: string, state: "done" | "skipped" = "done", routine = "routine") {
  const id = "fact-" + routine + "-" + on;
  const parent = w.nodes.get(routine);
  if (parent === undefined) throw new Error("missing routine");
  if (!parent.children.includes(id))
    w.nodes.set(routine, { ...parent, children: [...parent.children, id] });
  w.nodes.set(
    id,
    node(id, T.occurrence, { [F.on]: str(on), [F.state]: ref(routineOption("state", state)) }),
  );
  w.touch(routine, id);
  return id;
}
/** Take a fact back, as unticking Done deletes it. */
function untick(w: World, id: string, routine = "routine") {
  const parent = w.nodes.get(routine);
  if (parent === undefined) throw new Error("missing routine");
  w.nodes.set(routine, { ...parent, children: parent.children.filter((child) => child !== id) });
  w.nodes.delete(id);
  w.touch(routine, id);
}

function scenario(name: string, body: () => Effect.Effect<void, SyncError, Scope.Scope>) {
  test(name, () =>
    Effect.runPromise(
      Effect.scoped(
        TestClock.setTime(1793667600000).pipe(Effect.andThen(Effect.suspend(body))),
      ).pipe(Effect.provide(TestClock.layer())),
    ),
  );
}

scenario("a restart with nothing changed lists each calendar once and writes nothing", () =>
  Effect.gen(function* () {
    const w = world();
    const first = yield* start(w);
    fact(w, "2026-11-05");
    yield* flush(first);
    expect(w.counts.puts).toBe(2);
    expect(stored(w, "routine")?.state).toBe("synced");
    const sent = onDay(w, "2026-11-05");
    expect(sent).toMatchObject({
      state: "synced",
      eventId: expect.stringContaining("_2026-11-05"),
    });
    const before = { ...w.counts };
    const again = yield* start(w);
    expect(w.counts.puts).toBe(before.puts);
    expect(w.counts.lists).toBe(before.lists + 1);
    // Nothing is written to the store either: each node already says what the pass found.
    expect(w.counts.statuses).toBe(before.statuses);
    expect(onDay(w, "2026-11-05")).toEqual(sent);
    // Sync now with nothing changed writes nothing either.
    yield* again.syncNow;
    yield* again.step;
    expect(w.counts.puts).toBe(before.puts);
    expect(w.counts.statuses).toBe(before.statuses);
  }),
);

scenario(
  "an instance Google holds as an exception is written to its listed id, never looked up",
  () =>
    Effect.gen(function* () {
      // Google refused the lookup for an instance once it was an exception (2026-11-17).
      const w = world(makeFakeCalendar({ refusesExceptions: true }));
      const first = yield* start(w);
      fact(w, "2026-11-05");
      yield* flush(first);
      expect(w.fake.lookups).toHaveLength(1);
      const again = yield* start(w);
      fact(w, "2026-11-05", "skipped");
      yield* flush(again);
      expect(w.fake.lookups).toHaveLength(1);
      expect(event(w, "_2026-11-05")?.status).toBe("cancelled");
      expect(stored(w, "routine")?.state).toBe("synced");
      expect(onDay(w, "2026-11-05")?.state).toBe("synced");
    }),
);

scenario(
  "a failing instance fails only itself: its series is synced, and the writes after it wait",
  () =>
    Effect.gen(function* () {
      const w = world();
      const engine = yield* start(w);
      fact(w, "2026-11-04");
      fact(w, "2026-11-05");
      yield* engine.tail;
      // Only the instances that changed wait; their series stays as it was sent.
      expect(onDay(w, "2026-11-04")?.state).toBe("pending");
      expect(onDay(w, "2026-11-05")?.state).toBe("pending");
      expect(stored(w, "routine")?.state).toBe("synced");
      w.fail(1, (id) => id.endsWith("_2026-11-04"));
      yield* flush(engine);
      expect(stored(w, "routine")?.state).toBe("synced");
      expect(onDay(w, "2026-11-04")).toMatchObject({ state: "error", message: "unavailable" });
      expect(onDay(w, "2026-11-05")?.state).toBe("pending");
      // The retry sends both, and the series is not sent again.
      yield* TestClock.adjust("16 minutes");
      yield* engine.step;
      expect(onDay(w, "2026-11-04")?.state).toBe("synced");
      expect(onDay(w, "2026-11-05")?.state).toBe("synced");
      expect(w.counts.puts).toBe(1 + 1 + 2);
    }),
);

scenario(
  "a crash partway through a pass resumes from what Google got, creating nothing twice",
  () =>
    Effect.gen(function* () {
      const w = world();
      fact(w, "2026-11-05");
      w.fail(1, (id) => id.includes("_"));
      // The first host sends the series, then dies on the instance.
      yield* start(w);
      expect(w.fake.events.size).toBe(1);
      yield* start(w);
      expect(w.fake.events.size).toBe(2);
      // The series Google already held was not sent again.
      expect(w.counts.puts).toBe(3);
      expect(stored(w, "routine")?.state).toBe("synced");
      expect(onDay(w, "2026-11-05")?.state).toBe("synced");
    }),
);

scenario(
  "a store from before: each event is sent once more, to its listed id, and its old status is replaced",
  () =>
    Effect.gen(function* () {
      const w = world();
      const first = yield* start(w);
      fact(w, "2026-11-05");
      yield* flush(first);
      // As the owner's store was: events without kbSent, and an error left on the series.
      w.fake.forgetDigests();
      const routine = w.nodes.get("routine");
      if (routine === undefined) throw new Error("missing routine");
      w.nodes.set("routine", {
        ...routine,
        props: {
          ...routine.props,
          "sys.f.routines.status": ref("sys.f.routines.status.error"),
          "sys.f.routines.message": str("instance_not_found"),
        },
      });
      const lookups = w.fake.lookups.length;
      const puts = w.counts.puts;
      yield* start(w);
      expect(w.counts.puts).toBe(puts + 2);
      expect(w.fake.lookups).toHaveLength(lookups);
      expect(stored(w, "routine")).toMatchObject({ state: "synced", message: "" });
      expect(onDay(w, "2026-11-05")?.state).toBe("synced");
      yield* start(w);
      expect(w.counts.puts).toBe(puts + 2);
    }),
);

scenario("an edit waits for five quiet seconds, and at most thirty", () =>
  Effect.gen(function* () {
    const w = world();
    const engine = yield* start(w);
    const puts = w.counts.puts;
    // Edits every four seconds never fall quiet: the first is sent thirty seconds on.
    for (let index = 0; index < 8; index++) {
      yield* TestClock.adjust("4 seconds");
      const current = w.nodes.get("routine");
      if (current === undefined) throw new Error("missing routine");
      w.nodes.set(current.id, { ...current, text: "edit-" + index });
      w.touch(current.id);
      yield* engine.step;
    }
    expect(w.counts.puts).toBe(puts);
    yield* TestClock.adjust("2 seconds");
    yield* engine.step;
    expect(w.counts.puts).toBe(puts + 1);
  }),
);

scenario("retries stop at ten; Sync now and a change start them again", () =>
  Effect.gen(function* () {
    const w = world();
    w.fail(10);
    const engine = yield* start(w);
    for (let attempt = 1; attempt < 10; attempt++) {
      yield* TestClock.adjust("16 minutes");
      yield* engine.step;
    }
    expect(w.counts.puts).toBe(10);
    yield* TestClock.adjust("16 minutes");
    yield* engine.step;
    expect(w.counts.puts).toBe(10);
    expect(stored(w, "routine")?.state).toBe("error");
    yield* engine.syncNow;
    yield* engine.step;
    expect(stored(w, "routine")?.state).toBe("synced");
  }),
);

scenario(
  "taking back Done sends the day back to its default, and never says its series waits",
  () =>
    Effect.gen(function* () {
      const w = world();
      const engine = yield* start(w);
      const id = fact(w, "2026-11-05");
      yield* flush(engine);
      expect(event(w, "_2026-11-05")?.done).toBe(true);
      untick(w, id);
      // GAP [[01M7JGRXEA5AWPZS3SKTRQY45E]] the day has no node to say its write waits.
      yield* engine.tail;
      expect(stored(w, "routine")?.state).toBe("synced");
      yield* flush(engine);
      expect(event(w, "_2026-11-05")?.done).toBe(false);
      expect(stored(w, "routine")?.state).toBe("synced");
    }),
);

scenario("a change taken back before it is sent writes nothing and is synced again", () =>
  Effect.gen(function* () {
    const w = world();
    const engine = yield* start(w);
    const sent = w.nodes.get("routine");
    if (sent === undefined) throw new Error("missing routine");
    w.nodes.set(sent.id, { ...sent, text: "renamed" });
    w.touch(sent.id);
    yield* engine.tail;
    expect(stored(w, "routine")?.state).toBe("pending");
    const pending = w.nodes.get(sent.id);
    if (pending === undefined) throw new Error("missing routine");
    w.nodes.set(sent.id, { ...pending, text: sent.text });
    w.touch(sent.id);
    yield* flush(engine);
    expect(w.counts.puts).toBe(1);
    expect(stored(w, "routine")?.state).toBe("synced");
  }),
);

for (const kind of ["recurring", "one-off"] as const)
  scenario("a " + kind + " event deleted is ended, and restored is published again", () =>
    Effect.gen(function* () {
      const w = world();
      const original = w.nodes.get("routine");
      if (original === undefined) throw new Error("missing routine");
      const { [F.rrule]: rule, ...once } = original.props;
      w.nodes.set(original.id, {
        ...original,
        props: kind === "one-off" ? once : { ...once, [F.rrule]: rule ?? [] },
      });
      const id = fact(w, kind === "one-off" ? "2026-11-03" : "2026-11-05");
      const engine = yield* start(w);
      const routine = w.nodes.get("routine");
      const done = w.nodes.get(id);
      if (routine === undefined || done === undefined) throw new Error("missing fixture");
      const puts = w.counts.puts;
      w.nodes.delete(routine.id);
      w.nodes.delete(id);
      w.touch(routine.id, id);
      yield* flush(engine);
      expect(w.counts.puts).toBe(puts + 1);
      const parent = [...w.fake.events].find(([key]) => !key.includes("_"));
      if (parent === undefined) throw new Error("no series event");
      expect(kind === "one-off" ? parent[1].status : parent[1].recurrence[0]).toEqual(
        kind === "one-off" ? "cancelled" : expect.stringContaining("UNTIL="),
      );
      // Ended once: a later pass leaves it as it is.
      yield* engine.syncNow;
      yield* engine.step;
      expect(w.counts.puts).toBe(puts + 1);
      w.nodes.set(routine.id, routine);
      w.nodes.set(id, done);
      w.touch(routine.id, id);
      yield* flush(engine);
      const restored = w.fake.events.get(parent[0]);
      if (kind === "one-off") expect(restored).toMatchObject({ status: "confirmed", done: true });
      else {
        expect(restored?.recurrence[0]).not.toContain("UNTIL=");
        expect(event(w, "_2026-11-05")?.done).toBe(true);
      }
      expect(stored(w, "routine")?.state).toBe("synced");
    }),
  );

scenario("an event deleted while the host was stopped ends at the next start", () =>
  Effect.gen(function* () {
    const w = world();
    yield* start(w);
    w.nodes.delete("routine");
    yield* start(w);
    expect(event(w, "")?.recurrence[0]).toContain("UNTIL=");
  }),
);

scenario("more than five endings in a pass wait for their release, each one", () =>
  Effect.gen(function* () {
    const w = world();
    for (let index = 0; index < 5; index++)
      w.nodes.set("extra-" + index, routineNode("extra-" + index));
    const engine = yield* start(w);
    expect(w.counts.puts).toBe(6);
    const ids = [...w.nodes.keys()].filter((id) => id !== "calendar");
    for (const id of ids) w.nodes.delete(id);
    w.touch(...ids);
    yield* flush(engine);
    expect(w.counts.puts).toBe(6);
    expect((yield* engine.status()).pendingDeletions).toEqual(ids.toSorted());
    expect(stored(w, "calendar")?.message).toContain("release");
    yield* engine.release(ids);
    yield* engine.step;
    expect(w.counts.puts).toBe(12);
    expect(
      [...w.fake.events.values()].every(
        (fields) => fields.recurrence[0]?.includes("UNTIL=") === true,
      ),
    ).toBe(true);
    expect((yield* engine.status()).pendingDeletions).toEqual([]);
    expect(stored(w, "calendar")).toMatchObject({ state: "synced", message: "" });
  }),
);

scenario("moving an event to another calendar ends its series on the old one", () =>
  Effect.gen(function* () {
    const w = world();
    const engine = yield* start(w);
    const routine = w.nodes.get("routine");
    if (routine === undefined) throw new Error("missing routine");
    w.nodes.set("other", calendarNode("other", "new-google"));
    w.nodes.set(routine.id, {
      ...routine,
      props: { ...routine.props, [F.calendar]: ref("other") },
    });
    w.touch(routine.id, "other");
    yield* flush(engine);
    const old = [...w.fake.events].find(([key]) => key.startsWith("google/"));
    const moved = [...w.fake.events].find(([key]) => key.startsWith("new-google/"));
    expect(old?.[1].recurrence[0]).toContain("UNTIL=");
    expect(moved?.[1].recurrence[0]).not.toContain("UNTIL=");
  }),
);

/** The series each Google calendar holds of the routine, by calendar. */
const seriesOn = (w: World, google: string) =>
  [...w.fake.events].find(
    ([key, fields]) => key.startsWith(google + "/") && fields.recurrence.length > 0,
  )?.[1];

scenario("re-pointing a calendar at another Google calendar ends kb's series on the old one", () =>
  Effect.gen(function* () {
    const w = world();
    const engine = yield* start(w);
    w.nodes.set("calendar", calendarNode("calendar", "other-google"));
    w.touch("calendar");
    yield* flush(engine);
    expect(seriesOn(w, "google")?.recurrence[0]).toContain("UNTIL=");
    expect(seriesOn(w, "other-google")?.recurrence[0]).not.toContain("UNTIL=");
    // Nothing of kb's runs there now, so the next passes leave it alone.
    const lists = w.counts.lists;
    yield* engine.syncNow;
    yield* engine.step;
    expect(w.counts.lists - lists).toBe(2);
    yield* engine.syncNow;
    yield* engine.step;
    expect(w.counts.lists - lists).toBe(3);
  }),
);

scenario("a calendar re-pointed while the host was stopped is read from the store's history", () =>
  Effect.gen(function* () {
    const w = world();
    yield* start(w);
    w.nodes.set("calendar", calendarNode("calendar", "other-google"));
    w.touch("calendar");
    yield* start(w);
    expect(seriesOn(w, "google")?.recurrence[0]).toContain("UNTIL=");
    expect(seriesOn(w, "other-google")?.recurrence[0]).not.toContain("UNTIL=");
  }),
);

scenario(
  "a paused calendar re-pointed writes nothing, and ends its old series once it resumes",
  () =>
    Effect.gen(function* () {
      const w = world();
      const engine = yield* start(w);
      w.nodes.set("calendar", calendarNode("calendar", "google", "paused"));
      w.touch("calendar");
      yield* flush(engine);
      const puts = w.counts.puts;
      w.nodes.set("calendar", calendarNode("calendar", "other-google", "paused"));
      w.touch("calendar");
      yield* flush(engine);
      expect(w.counts.puts).toBe(puts);
      expect(seriesOn(w, "google")?.recurrence[0]).not.toContain("UNTIL=");
      expect(seriesOn(w, "other-google")).toBeUndefined();
      w.nodes.set("calendar", calendarNode("calendar", "other-google"));
      w.touch("calendar");
      yield* flush(engine);
      expect(seriesOn(w, "google")?.recurrence[0]).toContain("UNTIL=");
      expect(seriesOn(w, "other-google")?.recurrence[0]).not.toContain("UNTIL=");
    }),
);

scenario("a former calendar no longer trusted keeps saying so", () =>
  Effect.gen(function* () {
    const w = world();
    const engine = yield* start(w);
    w.distrusted.add(
      yield* calendarBindingDigest({
        calendar: readCalendar(calendarNode("calendar", "google")),
        account: null,
      }),
    );
    w.nodes.set("calendar", calendarNode("calendar", "other-google"));
    w.touch("calendar");
    yield* flush(engine);
    // The calendar node says so, naming the Google calendar it cannot reach.
    const untrusted = { state: "error", message: "google: untrusted" };
    expect(stored(w, "calendar")).toMatchObject(untrusted);
    expect(seriesOn(w, "google")?.recurrence[0]).not.toContain("UNTIL=");
    expect(seriesOn(w, "other-google")?.recurrence[0]).not.toContain("UNTIL=");
    yield* engine.syncNow;
    yield* engine.step;
    expect(stored(w, "calendar")).toMatchObject(untrusted);
  }),
);

scenario("a calendar node deleted ends kb's series on its Google calendar", () =>
  Effect.gen(function* () {
    const w = world();
    const engine = yield* start(w);
    w.nodes.delete("calendar");
    w.touch("calendar");
    yield* flush(engine);
    expect(seriesOn(w, "google")?.recurrence[0]).toContain("UNTIL=");
  }),
);

scenario("an event a person made in kb's calendar is left as it is", () =>
  Effect.gen(function* () {
    const w = world();
    const theirs: EventFields = {
      title: "Dentist",
      start: { day: "2026-11-04", at: "09:00", zone: "Asia/Ho_Chi_Minh" },
      end: { day: "2026-11-04", at: "10:00", zone: "Asia/Ho_Chi_Minh" },
      recurrence: ["RRULE:FREQ=WEEKLY"],
      status: "confirmed",
      nodeId: "",
      unit: "",
      generation: 0,
      backlink: "",
      done: false,
    };
    w.fake.events.set("google/theirs", theirs);
    yield* start(w);
    expect(w.counts.puts).toBe(1);
    expect(w.fake.events.get("google/theirs")).toEqual(theirs);
  }),
);

for (const change of ["day", "tag"] as const)
  scenario("a fact whose " + change + " changes sends its old day back to the default", () =>
    Effect.gen(function* () {
      const w = world();
      const engine = yield* start(w);
      const id = fact(w, "2026-11-03", "skipped");
      yield* flush(engine);
      expect(event(w, "_2026-11-03")?.status).toBe("cancelled");
      const written = w.nodes.get(id);
      if (written === undefined) throw new Error("missing fact");
      w.nodes.set(id, {
        ...written,
        props: {
          ...written.props,
          ...(change === "day" ? { [F.on]: str("2026-11-04") } : { [SYSTEM_IDS.typeField]: [] }),
        },
      });
      w.touch(id);
      yield* flush(engine);
      expect(event(w, "_2026-11-03")?.status).toBe("confirmed");
      if (change === "day") expect(event(w, "_2026-11-04")?.status).toBe("cancelled");
    }),
  );

scenario("a one-off's fact on its day is its one event's own state", () =>
  Effect.gen(function* () {
    const w = world();
    const parent = w.nodes.get("routine");
    if (parent === undefined) throw new Error("missing routine");
    const { [F.rrule]: _rule, ...props } = parent.props;
    w.nodes.set(parent.id, { ...parent, props });
    const engine = yield* start(w);
    const only = Effect.gen(function* () {
      yield* flush(engine);
      const events = [...w.fake.events.values()];
      expect(events).toHaveLength(1);
      return events[0];
    });
    fact(w, "2026-11-03");
    expect(yield* only).toMatchObject({ unit: "one-off", recurrence: [], done: true });
    const id = fact(w, "2026-11-03", "skipped");
    expect(yield* only).toMatchObject({ status: "cancelled", done: false });
    untick(w, id);
    expect(yield* only).toMatchObject({ status: "confirmed", done: false });
    expect(stored(w, "routine")?.state).toBe("synced");
  }),
);

scenario(
  "a calendar whose Google calendar cannot be listed says so on its node, not its events",
  () =>
    Effect.gen(function* () {
      const w = world();
      const engine = yield* start(w);
      w.failLists(1);
      yield* engine.syncNow;
      yield* engine.step;
      expect(stored(w, "calendar")?.state).toBe("error");
      expect(stored(w, "routine")?.state).toBe("synced");
    }),
);

scenario("the status action answers each node's status fields and the held endings", () =>
  Effect.gen(function* () {
    const w = world();
    const engine = yield* start(w);
    const answered = yield* engine.status();
    expect(answered.pendingDeletions).toEqual([]);
    const routine = answered.nodes.find((held) => held.id === "routine");
    expect(routine?.props[F.status]).toEqual(ref(routineOption("status", "synced")));
  }),
);
