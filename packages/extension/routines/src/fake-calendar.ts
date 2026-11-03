import { Effect } from "effect";
import { SyncError, type EventFields } from "./model.ts";
import type { CalendarPort } from "./ports.ts";

const result = (id: string) => ({ id, url: "https://calendar.test/event/" + id });
/** In-memory adapter obeying the same push contract as Google. */
export function makeFakeCalendar() {
  const events = new Map<string, EventFields>();
  let sequence = 0;

  const port: CalendarPort = {
    create: () => Effect.sync(() => "calendar-" + ++sequence),
    put: (calendar, id, fields) =>
      Effect.sync(() => {
        events.set(calendar + "/" + id, structuredClone(fields));
        return result(id);
      }),
    instance: (calendar, series, original) =>
      Effect.gen(function* () {
        if (!events.has(calendar + "/" + series))
          return yield* new SyncError({ status: 404, code: "not_found" });
        return result(series + "_" + original.day);
      }),
  };
  return { port, events };
}
