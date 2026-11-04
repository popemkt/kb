import { Effect } from "effect";
import type { CalendarPort } from "./ports.ts";
import type { EventFields, SyncError } from "./model.ts";
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
/** Every adapter proves idempotent overwrite, response identity and opaque exceptions. */
export function calendarContract(
  test: (name: string, effect: Effect.Effect<void, SyncError>) => void,
  port: CalendarPort,
  inspect: (calendar: string, id: string) => Effect.Effect<EventFields | undefined>,
  equal: (actual: unknown, expected: unknown) => void,
) {
  test(
    "put repeats the same identity and overwrites prior event content",
    Effect.gen(function* () {
      const calendar = yield* port.create("kb", "Asia/Ho_Chi_Minh");
      const id = "kb0123456789abcdef";
      const first = yield* port.put(calendar, id, contractEvent);
      const changed = { ...contractEvent, title: "Edited in kb" };
      const second = yield* port.put(calendar, id, changed);
      equal(second.id, first.id);
      equal(second.url.length > 0, true);
      equal((yield* inspect(calendar, id))?.title, changed.title);
      const instance = yield* port.instance(calendar, id, contractEvent.start, "Asia/Ho_Chi_Minh");
      const done = { ...changed, recurrence: [], done: true };
      equal((yield* port.put(calendar, instance.id, done)).id, instance.id);
      equal((yield* inspect(calendar, instance.id))?.done, true);
    }),
  );
}
