import { expect, test } from "bun:test";
import { Effect, Result } from "effect";
import { contractEvent } from "@kb/routines";
import { decodeEvent, encodeEvent, decodeTime } from "../src/wire.ts";
import { googleHttp } from "../src/http.ts";

test("done decoration and default reminders have independent wire assertions", () => {
  const normal = encodeEvent(contractEvent(), "runner");
  expect(normal.reminders).toEqual({ useDefault: true });
  expect(normal.start).toEqual({ dateTime: "2026-11-02T07:30:00", timeZone: "Asia/Ho_Chi_Minh" });
  const done = encodeEvent({ ...contractEvent(), done: true }, "runner");
  expect(done.summary).toBe("✅ Morning");
  expect(done.colorId).toBe("8");
  expect(done.reminders).toEqual({ useDefault: false, overrides: [] });
  expect(done.extendedProperties.private).toMatchObject({
    kbNode: "routine",
    kbUnit: "series",
    kbGen: "0",
    kbRunner: "runner",
  });
  expect(decodeEvent({ ...done, id: "event", etag: '"etag"' }).fields?.title).toBe("Morning");
});
test("minimal cancelled instances keep original identity; explicit offsets win at DST folds", () => {
  const event = decodeEvent({
    id: "opaque",
    status: "cancelled",
    recurringEventId: "parent",
    originalStartTime: { date: "2026-11-03" },
  });
  expect(event.fields).toBeNull();
  expect(event.seriesId).toBe("parent");
  expect(event.originalStart?.day).toBe("2026-11-03");
  expect(
    decodeTime({ dateTime: "2026-11-01T01:30:00-05:00", timeZone: "America/New_York" }),
  ).toEqual({ day: "2026-11-01", at: "01:30", zone: "America/New_York" });
  expect(
    decodeTime({ dateTime: "2026-11-01T06:30:17.123Z", timeZone: "America/New_York" }).at,
  ).toBe("01:30:17.123");
});
test("quota reasons and Retry-After are sanitized without reflecting upstream messages", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const http = googleHttp({ access: Effect.succeed("unused"), refresh: Effect.void });
      const error = yield* http.responseError(
        new Response(
          JSON.stringify({
            error: { message: "private-response", errors: [{ reason: "userRateLimitExceeded" }] },
          }),
          { status: 403, headers: { "Retry-After": "120" } },
        ),
      );
      expect(error.code).toBe("quota");
      expect(error.retryAfter).toBe(120_000);
      expect(JSON.stringify(error)).not.toContain("private-response");
      let refreshes = 0;
      const denied = googleHttp({
        access: Effect.succeed("unused"),
        refresh: Effect.sync(() => {
          refreshes++;
        }),
      });
      const failed = yield* Effect.result(denied.authorize(() => Effect.fail(error)));
      expect(Result.isFailure(failed)).toBe(true);
      expect(refreshes).toBe(0);
    }),
  ));
