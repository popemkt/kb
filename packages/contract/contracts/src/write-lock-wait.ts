import { Clock, Duration, Effect, Option } from "effect";

/**
 * How long a writer waits for another writer's lock before it gives up:
 * every adapter's commit, and every other file kb writes under a lock, so a
 * contended write behaves the same whichever adapter holds the store.
 */
export const WRITE_LOCK_WAIT = Duration.seconds(15);

/** How long a waiter sleeps between tries. */
export const WRITE_LOCK_RETRY = Duration.millis(25);

/**
 * Take a write lock the one way kb waits for one: try without blocking, and
 * while another writer holds the lock, sleep {@link WRITE_LOCK_RETRY} on the
 * Effect clock and try again, until {@link WRITE_LOCK_WAIT} has passed. The
 * thread is never blocked while it waits, so a host that serves other
 * callers from the same event loop (`kb ui`, `kb mcp`) keeps answering them
 * while one of its writes queues behind another process.
 *
 * `attempt` tries once, given the clock's time: `Some` once it holds the
 * lock, `None` while another writer does. `timedOut` is the adapter's own
 * failure, which names the holder when it can.
 */
export const takeWriteLock = <A, E, E2>(
  attempt: (nowMs: number) => Effect.Effect<Option.Option<A>, E>,
  timedOut: Effect.Effect<never, E2>,
): Effect.Effect<A, E | E2> =>
  Effect.gen(function* () {
    const started = yield* Clock.currentTimeMillis;
    for (;;) {
      const now = yield* Clock.currentTimeMillis;
      const got = yield* attempt(now);
      if (Option.isSome(got)) return got.value;
      if (now - started > Duration.toMillis(WRITE_LOCK_WAIT)) return yield* timedOut;
      yield* Effect.sleep(WRITE_LOCK_RETRY);
    }
  });
