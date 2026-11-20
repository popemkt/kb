import { expect, test } from "bun:test";
import { Clock, Effect, Fiber, Option } from "effect";
import { TestClock } from "effect/testing";
import { takeWriteLock, WriteLockDeadline } from "../src/index.ts";

test("lock attempts spend the caller's deadline across calls", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const start = yield* Clock.currentTimeMillis;
        const attempts: number[] = [];
        const wait = takeWriteLock(
          (now) =>
            Effect.sync(() => {
              attempts.push(now - start);
              return Option.none();
            }),
          Effect.fail("lock wait expired"),
        ).pipe(Effect.result, Effect.provideService(WriteLockDeadline, start + 30));

        const first = yield* Effect.forkScoped(wait, { startImmediately: true });
        yield* TestClock.adjust(30);
        expect(yield* Fiber.join(first)).toMatchObject({ failure: "lock wait expired" });
        expect(yield* wait).toMatchObject({ failure: "lock wait expired" });
        expect(attempts).toEqual([0, 25]);
      }),
    ).pipe(Effect.provide(TestClock.layer())),
  ));
