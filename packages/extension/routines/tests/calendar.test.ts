import { expect, test } from "bun:test";
import { Effect } from "effect";
import { calendarContract, makeFakeCalendar } from "../src/index.ts";
const fake = makeFakeCalendar();
calendarContract(
  (name, effect) => test(name, () => Effect.runPromise(effect)),
  fake.port,
  (calendar, id) => Effect.sync(() => fake.events.get(calendar + "/" + id)),
  (a, b) => expect(a).toEqual(b),
);
