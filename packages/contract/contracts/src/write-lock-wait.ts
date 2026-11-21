import { Clock, Duration, Effect, Option } from "effect";
import { WriteLockDeadline } from "./write-lock-deadline.ts";

/** How long a writer waits for a lock when its caller has no deadline. */
export const WRITE_LOCK_WAIT = Duration.seconds(15);

/** How long a waiter sleeps between tries. */
export const WRITE_LOCK_RETRY = Duration.millis(25);

/**
 * Try without blocking, sleeping up to {@link WRITE_LOCK_RETRY} between tries
 * until {@link WriteLockDeadline} or the default {@link WRITE_LOCK_WAIT} expires.
 * No attempt starts at or past the deadline, even on a subsequent call.
 *
 * `attempt` tries once, given the clock's time: `Some` once it holds the
 * lock, `None` while another writer does. `timedOut` is the adapter's own
 * failure, which names the holder when it can.
 */
export const takeWriteLock = Effect.fn("kb.takeWriteLock")(function* <A, E, E2>(
  attempt: (nowMs: number) => Effect.Effect<Option.Option<A>, E>,
  timedOut: Effect.Effect<never, E2>,
): Effect.fn.Return<A, E | E2> {
  const supplied = yield* WriteLockDeadline;
  const deadline =
    supplied ?? (yield* Clock.currentTimeMillis) + Duration.toMillis(WRITE_LOCK_WAIT);
  for (;;) {
    const now = yield* Clock.currentTimeMillis;
    if (now >= deadline) return yield* timedOut;
    const got = yield* attempt(now);
    if (Option.isSome(got)) return got.value;
    const remaining = deadline - (yield* Clock.currentTimeMillis);
    if (remaining > 0)
      yield* Effect.sleep(Math.min(remaining, Duration.toMillis(WRITE_LOCK_RETRY)));
  }
});
