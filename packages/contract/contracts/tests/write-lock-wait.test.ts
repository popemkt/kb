import { expect, test } from "bun:test";
import { Clock, Duration, Effect, Fiber, Option } from "effect";
import { TestClock } from "effect/testing";
import { takeWriteLock, WRITE_LOCK_WAIT, WriteLockDeadline } from "../src/index.ts";

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

test("a caller's deadline only brings the wait's end forward, never past the wait a write starts with", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const start = yield* Clock.currentTimeMillis;
        let last = 0;
        const wait = takeWriteLock(
          (now) =>
            Effect.sync(() => {
              last = now - start;
              return Option.none();
            }),
          Effect.fail("lock wait expired"),
        ).pipe(Effect.result, Effect.provideService(WriteLockDeadline, start + 60_000));

        const waiting = yield* Effect.forkScoped(wait, { startImmediately: true });
        yield* TestClock.adjust(Duration.toMillis(WRITE_LOCK_WAIT));
        expect(yield* Fiber.join(waiting)).toMatchObject({ failure: "lock wait expired" });
        expect(last).toBeLessThan(Duration.toMillis(WRITE_LOCK_WAIT));
      }),
    ).pipe(Effect.provide(TestClock.layer())),
  ));
