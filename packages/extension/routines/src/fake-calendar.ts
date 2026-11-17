import { Effect } from "effect";
import { SyncError, type EventFields, type EventTime, type RemoteEvent } from "./model.ts";
import type { CalendarPort } from "./ports.ts";
import { sentDigest } from "./sent.ts";

const result = (id: string) => ({ id, url: "https://calendar.test/event/" + id });
/**
 * In-memory adapter obeying the same push contract as Google. Like Google, it
 * lists a written instance as an exception of its series, and keeps nothing
 * of a cancelled event but its ids. `refusesExceptions` makes its instance
 * lookup refuse an instance that is already an exception, as Google was seen
 * to on 2026-11-17, so a test can prove the lookup is not used for one.
 */
export function makeFakeCalendar(options: { readonly refusesExceptions?: boolean } = {}) {
  const events = new Map<string, EventFields>();
  const digests = new Map<string, string>();
  /** Each instance id the lookup handed out: its series and its original start. */
  const instances = new Map<string, { series: string; original: EventTime }>();
  const lookups: string[] = [];
  let sequence = 0;
  const remote = (key: string, fields: EventFields): RemoteEvent => {
    const id = key.slice(key.indexOf("/") + 1);
    const cancelled = fields.status === "cancelled";
    return {
      id,
      url: result(id).url,
      exception: instances.get(key) ?? null,
      cancelled,
      fields: cancelled ? null : structuredClone(fields),
      digest: cancelled ? null : (digests.get(key) ?? null),
    };
  };

  const port: CalendarPort = {
    create: () => Effect.sync(() => "calendar-" + ++sequence),
    put: (calendar, id, fields) =>
      Effect.gen(function* () {
        const digest = yield* sentDigest(fields);
        events.set(calendar + "/" + id, structuredClone(fields));
        digests.set(calendar + "/" + id, digest);
        return result(id);
      }),
    list: (calendar) =>
      Effect.sync(() =>
        [...events]
          .filter(([key]) => key.startsWith(calendar + "/"))
          .map(([key, fields]) => remote(key, fields)),
      ),
    instance: (calendar, series, original, zone) =>
      Effect.gen(function* () {
        if (!events.has(calendar + "/" + series))
          return yield* new SyncError({ status: 404, code: "not_found" });
        const id = series + "_" + original.day;
        lookups.push(id);
        if (options.refusesExceptions === true && events.has(calendar + "/" + id))
          return yield* new SyncError({ status: 409, code: "instance_not_found" });
        instances.set(calendar + "/" + id, {
          series,
          original: { ...original, zone: original.zone ?? zone },
        });
        return result(id);
      }),
  };
  /** Forget what kb stored with each event, as an event written before `kbSent` reads. */
  const forgetDigests = () => digests.clear();
  return { port, events, lookups, forgetDigests };
}
