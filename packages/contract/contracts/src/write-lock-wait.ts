import { Clock, Duration, Effect, Option } from "effect";
import { WriteLockDeadline, WriteLockTaken } from "./write-lock-deadline.ts";

/** How long a writer waits for a lock when its caller has no deadline. */
export const WRITE_LOCK_WAIT = Duration.seconds(15);

/** How long a waiter sleeps between tries. */
export const WRITE_LOCK_RETRY = Duration.millis(25);

/**
 * When the lock wait of a write that begins now ends: {@link WRITE_LOCK_WAIT}
 * from now, or {@link WriteLockDeadline} if that comes first.
 */
export const writeLockEnd: Effect.Effect<number> = Effect.gen(function* () {
  return Math.min(
    (yield* WriteLockDeadline) ?? Number.POSITIVE_INFINITY,
    (yield* Clock.currentTimeMillis) + Duration.toMillis(WRITE_LOCK_WAIT),
  );
});

/**
 * Try without blocking, sleeping up to {@link WRITE_LOCK_RETRY} between tries
 * until {@link writeLockEnd} expires.
 * No attempt starts at or past the deadline, even on a subsequent call.
 *
 * `attempt` tries once, given the clock's time: `Some` once it holds the
 * lock, `None` while another writer does. `timedOut` is the adapter's own
 * failure, which names the holder when it can. Taking the lock tells
 * {@link WriteLockTaken}.
 *
 * Only a store adapter waits for a lock, so the call that builds this is
 * marked pure: a bundle that never takes one, the page's, drops it.
 */
export const takeWriteLock = /* @__PURE__ */ Effect.fn("kb.takeWriteLock")(function* <A, E, E2>(
  attempt: (nowMs: number) => Effect.Effect<Option.Option<A>, E>,
  timedOut: Effect.Effect<never, E2>,
): Effect.fn.Return<A, E | E2> {
  const deadline = yield* writeLockEnd;
  for (;;) {
    const now = yield* Clock.currentTimeMillis;
    if (now >= deadline) return yield* timedOut;
    const got = yield* attempt(now);
    if (Option.isSome(got)) {
      (yield* WriteLockTaken)();
      return got.value;
    }
    const remaining = deadline - (yield* Clock.currentTimeMillis);
    if (remaining > 0)
      yield* Effect.sleep(Math.min(remaining, Duration.toMillis(WRITE_LOCK_RETRY)));
  }
});
