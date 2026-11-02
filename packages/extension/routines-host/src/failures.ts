import { Clock, Effect, Random } from "effect";
import { retryDelay, type SyncError, type UnitRecord } from "@kb/routines";
import type { EngineContext } from "./context.ts";
import type { CalendarSession } from "./session.ts";

export const reportFailure = Effect.fn("routines.reportFailure")(function* (
  context: EngineContext,
  session: CalendarSession,
  error: SyncError,
  unit?: UnitRecord,
) {
  const at = yield* Clock.currentTimeMillis;
  const quota = error.status === 429 || error.code === "quota";
  const auth = error.status === 401 || error.code === "auth_needed";
  const transient = quota || error.status === 0 || error.status >= 500;
  const attempt = (unit?.attempts ?? 0) + 1;
  const delay = retryDelay(
    attempt,
    yield* Random.next,
    quota ? "quota" : "transport",
    error.retryAfter,
  );
  if (quota) session.limiter.pauseUntil = Math.max(session.limiter.pauseUntil, at + delay);
  if (auth)
    yield* context.options.ledger.cursor.set("auth:" + session.binding.account?.id, "needed");
  if (unit !== undefined)
    yield* context.queue.mutate(unit.key, (current) => ({
      ...current,
      state: transient && attempt < 10 ? "retry" : "failed",
      attempts: attempt,
      nextAttemptAt: at + delay,
      lastError: { status: error.status, code: auth ? "auth_needed" : error.code },
    }));
  yield* context.options.ledger.log.append({
    at,
    key: unit?.key ?? null,
    code: auth ? "auth_needed" : error.code,
  });
});
