import { expect, test } from "bun:test";
import { Effect } from "effect";
import { calendarContract, makeFakeCalendar } from "../src/index.ts";

calendarContract(
  (name, effect) => test("fake calendar: " + name, () => Effect.runPromise(Effect.scoped(effect))),
  Effect.sync(() => makeFakeCalendar().port),
  { equal: (a, b) => expect(a).toEqual(b), different: (a, b) => expect(a).not.toEqual(b) },
);
