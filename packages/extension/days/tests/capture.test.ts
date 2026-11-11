/**
 * Today for the store and where its captures go (DESIGN.md → Days): the
 * `time zone` setting names the zone, falling back to the process's, and
 * the `captures` setting sends captures to today unless it says the top
 * level. Captures committed through `node.add` are `@kb/runtime`'s
 * `days-capture.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { DateTime, Effect } from "effect";
import { TestClock } from "effect/testing";
import type { KbNode, PropValue } from "@kb/model";
import { capturesToday, storeToday } from "../src/capture";
import { DAYS_IDS } from "../src/ids";

const AT = "2026-11-11T00:00:00.000Z";

/** The family's node with `props` as its settings. */
function family(props: Record<string, PropValue[]> = {}): KbNode {
  return { id: DAYS_IDS.family, text: "Days", props, children: [], createdAt: AT, updatedAt: AT };
}

/** 20:00 UTC on 2026-11-11: already 03:00 on the 12th at UTC+7. */
const EVENING_UTC = Date.UTC(2026, 10, 11, 20);

/** `storeToday` over `nodes`, at {@link EVENING_UTC}, in a process whose zone is UTC. */
function todayIn(nodes: readonly KbNode[]): Promise<string> {
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(EVENING_UTC);
      return yield* storeToday(nodes);
    }).pipe(
      Effect.provide(TestClock.layer()),
      Effect.provideService(DateTime.CurrentTimeZone, DateTime.zoneMakeNamedUnsafe("UTC")),
    ),
  );
}

describe("storeToday", () => {
  test("the store's time zone setting says what today is", async () => {
    const zoned = family({ [DAYS_IDS.timeZoneField]: [{ t: "str", v: "Asia/Ho_Chi_Minh" }] });
    expect(await todayIn([zoned])).toBe("2026-11-12");
  });

  test("without the setting, or with a name that is no zone, it is the process's day", async () => {
    expect(await todayIn([family()])).toBe("2026-11-11");
    expect(await todayIn([])).toBe("2026-11-11");
    const unknown = family({ [DAYS_IDS.timeZoneField]: [{ t: "str", v: "Mars/Olympus" }] });
    expect(await todayIn([unknown])).toBe("2026-11-11");
  });
});

describe("capturesToday", () => {
  test("captures go to today unless the setting says the top level", () => {
    expect(capturesToday(undefined)).toBe(true);
    expect(capturesToday(family())).toBe(true);
    const today = family({ [DAYS_IDS.capturesField]: [{ t: "ref", v: DAYS_IDS.capturesToday }] });
    expect(capturesToday(today)).toBe(true);
    const top = family({ [DAYS_IDS.capturesField]: [{ t: "ref", v: DAYS_IDS.capturesTop }] });
    expect(capturesToday(top)).toBe(false);
  });
});
