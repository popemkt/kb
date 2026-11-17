import { Effect } from "effect";
import type { CalendarPort } from "./ports.ts";
import type { EventFields, SyncError } from "./model.ts";
import { owned, sentDigest, startDay } from "./sent.ts";
export const contractEvent: EventFields = {
  title: "Walk",
  start: { day: "2026-11-03", at: "08:00", zone: "Asia/Ho_Chi_Minh" },
  end: { day: "2026-11-03", at: "08:30", zone: "Asia/Ho_Chi_Minh" },
  recurrence: ["RRULE:FREQ=DAILY"],
  status: "confirmed",
  nodeId: "routine",
  unit: "series",
  generation: 0,
  backlink: "https://kb.test/node/routine",
  done: false,
};
const ZONE = "Asia/Ho_Chi_Minh";
/**
 * Every adapter proves idempotent overwrite, response identity, opaque
 * exceptions, and that its list reads back what kb put: each event with its
 * fields and digest, a written instance as an exception of its series, and a
 * cancelled event with nothing but its ids.
 */
export function calendarContract(
  test: (name: string, effect: Effect.Effect<void, SyncError>) => void,
  port: CalendarPort,
  inspect: (calendar: string, id: string) => Effect.Effect<EventFields | undefined>,
  equal: (actual: unknown, expected: unknown) => void,
) {
  test(
    "put repeats the same identity and overwrites prior event content",
    Effect.gen(function* () {
      const calendar = yield* port.create("kb", ZONE);
      const id = "kb0123456789abcdef";
      const first = yield* port.put(calendar, id, contractEvent);
      const changed = { ...contractEvent, title: "Edited in kb" };
      const second = yield* port.put(calendar, id, changed);
      equal(second.id, first.id);
      equal(second.url.length > 0, true);
      equal((yield* inspect(calendar, id))?.title, changed.title);
      const instance = yield* port.instance(calendar, id, contractEvent.start, ZONE);
      const done = { ...changed, recurrence: [], done: true };
      equal((yield* port.put(calendar, instance.id, done)).id, instance.id);
      equal((yield* inspect(calendar, instance.id))?.done, true);
    }),
  );
  test(
    "the list reads back each event kb put, with its fields and digest",
    Effect.gen(function* () {
      const calendar = yield* port.create("kb", ZONE);
      const id = "kb1123456789abcdef";
      yield* port.put(calendar, id, contractEvent);
      const listed = (yield* port.list(calendar)).find((event) => event.id === id);
      equal(listed?.exception, null);
      equal(listed?.cancelled, false);
      equal(listed?.fields, contractEvent);
      equal(listed?.digest, yield* sentDigest(contractEvent));
      equal(listed !== undefined && owned(listed), true);
    }),
  );
  test(
    "a written instance lists as an exception of its series, at its original start",
    Effect.gen(function* () {
      const calendar = yield* port.create("kb", ZONE);
      const id = "kb2123456789abcdef";
      yield* port.put(calendar, id, contractEvent);
      const instance = yield* port.instance(calendar, id, contractEvent.start, ZONE);
      const done = { ...contractEvent, recurrence: [], unit: "2026-11-03", done: true };
      yield* port.put(calendar, instance.id, done);
      const listed = (yield* port.list(calendar)).find((event) => event.id === instance.id);
      equal(listed?.exception?.series, id);
      equal(
        listed?.exception === null || listed?.exception === undefined
          ? null
          : startDay(listed.exception.original, ZONE),
        contractEvent.start.day,
      );
      equal(listed?.fields, done);
      equal(listed?.digest, yield* sentDigest(done));
    }),
  );
  test(
    "a cancelled event lists with nothing but its ids",
    Effect.gen(function* () {
      const calendar = yield* port.create("kb", ZONE);
      const id = "kb3123456789abcdef";
      yield* port.put(calendar, id, { ...contractEvent, recurrence: [], status: "cancelled" });
      const listed = (yield* port.list(calendar)).find((event) => event.id === id);
      equal(listed?.cancelled, true);
      equal(listed?.fields, null);
      equal(listed?.digest, null);
    }),
  );
}
