import { expect, test } from "bun:test";
import { Effect } from "effect";
import {
  project,
  canonicalRule,
  eventId,
  endSeries,
  settleAt,
  retryDelay,
  type Routine,
} from "../src/index.ts";

const routine: Routine = {
  id: "routine",
  title: "Morning",
  starts: "2026-03-07",
  at: "07:30",
  duration: 30,
  zone: "America/New_York",
  rrule: "FREQ=DAILY",
  until: null,
  repeatsFrom: "schedule",
};
test("wall time stays local across spring and fall DST; UNTIL uses the local day's end", () => {
  for (const starts of [
    "2026-03-07",
    "2026-03-08",
    "2026-03-09",
    "2026-10-31",
    "2026-11-01",
    "2026-11-02",
  ]) {
    const fields = project({ ...routine, starts }, "https://kb.test", 0);
    expect(fields.start.at).toBe("07:30");
    expect(fields.end.at).toBe("08:00");
    expect(fields.start.zone).toBe("America/New_York");
  }
  expect(project({ ...routine, until: "2026-03-08" }, "", 0).recurrence[0]).toContain(
    "UNTIL=20260309T035959Z",
  );
  expect(project({ ...routine, until: "2026-11-01" }, "", 0).recurrence[0]).toContain(
    "UNTIL=20261102T045959Z",
  );
  expect(
    project({ ...routine, zone: "Asia/Ho_Chi_Minh", until: "2026-11-02" }, "", 0).recurrence[0],
  ).toContain("UNTIL=20261102T165959Z");
});
test("all-day events use exclusive dates and DATE recurrence limits", () => {
  const fields = project(
    { ...routine, starts: "2028-02-29", at: null, until: "2028-03-01" },
    "",
    0,
  );
  expect(fields.start).toEqual({ day: "2028-02-29", at: null, zone: null });
  expect(fields.end.day).toBe("2028-03-01");
  expect(fields.recurrence[0]).toContain("UNTIL=20280301");
  expect(fields.recurrence[0]).not.toContain("T000000Z");
});
test("one-day exceptions keep original identity and own completion decoration", () => {
  const moved = project(routine, "", 2, {
    kind: "instance",
    on: "2026-03-08",
    occurrence: { id: "occ", on: "2026-03-08", state: "moved", movedTo: "2026-03-10", at: "09:00" },
  });
  expect(moved.unit).toBe("2026-03-08");
  expect(moved.start).toEqual({ day: "2026-03-10", at: "09:00", zone: "America/New_York" });
  expect(moved.recurrence).toEqual([]);
  const done = project(routine, "", 2, {
    kind: "instance",
    on: "2026-03-08",
    occurrence: { id: "occ", on: "2026-03-08", state: "done", movedTo: null, at: null },
  });
  expect(done.done).toBe(true);
  expect(done.title).toBe("Morning");
  const skipped = project(routine, "", 2, {
    kind: "instance",
    on: "2026-03-08",
    occurrence: { id: "occ", on: "2026-03-08", state: "skipped", movedTo: null, at: null },
  });
  expect(skipped.status).toBe("cancelled");
});
test("unsupported or malformed recurrence is refused", () => {
  for (const rule of [
    "FREQ=HOURLY",
    "FREQ=DAILY;BYHOUR=7",
    "FREQ=DAILY;EXDATE=20261102",
    "FREQ=WEEKLY;INTERVAL=0",
    "FREQ=MONTHLY;BYSETPOS=0",
    "FREQ=YEARLY;BYMONTH=13",
    "FREQ=DAILY;COUNT=1;UNTIL=20261102",
    "FREQ=DAILY;FREQ=WEEKLY",
  ]) {
    expect(() => canonicalRule(rule)).toThrow();
  }
  expect(() => project({ ...routine, repeatsFrom: "completion" }, "", 0)).toThrow();
  expect(() => project({ ...routine, zone: "not/a/zone" }, "", 0)).toThrow();
  expect(() => project({ ...routine, starts: "2026-02-30" }, "", 0)).toThrow();
});
test("event IDs are stable, calendar-scoped, generation-scoped base32hex", async () => {
  const first = await Effect.runPromise(eventId("calendar", "routine", "series", 0));
  expect(first).toMatch(/^kb[0-9a-v]{30}$/);
  expect(await Effect.runPromise(eventId("calendar", "routine", "series", 0))).toBe(first);
  expect(await Effect.runPromise(eventId("other", "routine", "series", 0))).not.toBe(first);
  expect(await Effect.runPromise(eventId("calendar", "routine", "series", 1))).not.toBe(first);
});
test("settling, cadence, retry caps and rate limiting are deterministic", () => {
  expect(settleAt(0, 4000)).toBe(9000);
  expect(settleAt(0, 29000)).toBe(30000);
  expect(retryDelay(20, 1, "transport")).toBe(900000);
  expect(retryDelay(20, 1, "quota")).toBe(64000);
  expect(retryDelay(0, 0, "quota", 120000)).toBe(120000);
});
test("ending a series never extends an existing UNTIL or exhausted COUNT", () => {
  const count = project({ ...routine, starts: "2026-01-01", rrule: "FREQ=DAILY;COUNT=3" }, "", 0);
  expect(endSeries(count, "2026-11-02").recurrence).toEqual(count.recurrence);
  const until = project({ ...routine, starts: "2026-01-01", until: "2026-01-03" }, "", 0);
  expect(endSeries(until, "2026-11-02").recurrence).toEqual(until.recurrence);
});
test("DST transitions preserve elapsed duration; one-offs accept the same sparse completion facts", () => {
  const spring = project({ ...routine, starts: "2026-03-08", at: "01:30", duration: 90 }, "", 0);
  expect(spring.end.at).toBe("04:00");
  const fall = project({ ...routine, starts: "2026-11-01", at: "00:30", duration: 180 }, "", 0);
  expect(fall.end.at).toBe("02:30");
  const oneOff = project({ ...routine, rrule: "" }, "", 0, {
    kind: "parent",
    occurrence: { id: "fact", on: routine.starts, state: "done", movedTo: null, at: null },
  });
  expect(oneOff.done).toBe(true);
  expect(oneOff.unit).toBe("one-off");
  expect(oneOff.recurrence).toEqual([]);
});
test("an RRULE's own DATE UNTIL uses the same timezone conversion as the until field", () => {
  const fields = project({ ...routine, rrule: "FREQ=DAILY;UNTIL=20261101" }, "", 0);
  expect(fields.recurrence[0]).toContain("UNTIL=20261102T045959Z");
  expect(
    project({ ...routine, at: null, rrule: "FREQ=DAILY;UNTIL=20261101" }, "", 0).recurrence[0],
  ).toContain("UNTIL=20261101");
  expect(() =>
    project({ ...routine, at: null, rrule: "FREQ=DAILY;UNTIL=20261102T045959Z" }, "", 0),
  ).toThrow();
});
