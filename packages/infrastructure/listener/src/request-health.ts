/**
 * A host's HTTP requests, each held to a deadline (DESIGN.md → Surfaces →
 * MCP; kb ui's server): a handler that overruns it is answered 503 and
 * aborted, and its work is tracked until it settles, so the host closes its
 * root only after every call in flight. The listener's idle timeout covers
 * the deadline, so a connection is never dropped under a handler still
 * within it.
 */
import { Effect, Fiber } from "effect";
import { pendingRequests } from "./pending-requests.ts";

/** Leave room for a screen command to spend its full wait inside a request. */
const REQUEST_DEADLINE_MS = 35_000;
export const HTTP_IDLE_TIMEOUT_SECONDS = Math.ceil(REQUEST_DEADLINE_MS / 1000) + 10;

const SAMPLE_INTERVAL_MS = 1_000;
const STALL_THRESHOLD_MS = 1_000;

/**
 * Track handler work until it settles, including cancellation after a
 * deadline. `report` takes a line for the host's stderr (a stall, an
 * overrun request), which the host prefixes with its name.
 */
export function requestHealth(report: (line: string) => void, deadlineMs = REQUEST_DEADLINE_MS) {
  const requests = pendingRequests();
  let nextSample = performance.now() + SAMPLE_INTERVAL_MS;
  let eventLoopLagMs = 0;
  const sample = Effect.runFork(
    Effect.forever(
      Effect.gen(function* () {
        yield* Effect.sleep(SAMPLE_INTERVAL_MS);
        const now = performance.now();
        eventLoopLagMs = Math.max(0, Math.round(now - nextSample));
        nextSample = now + SAMPLE_INTERVAL_MS;
        if (eventLoopLagMs >= STALL_THRESHOLD_MS) {
          report(`event loop stalled for ${String(eventLoopLagMs)} ms`);
        }
      }),
    ),
  );

  return {
    run(req: Request, pathname: string, handle: (signal: AbortSignal) => Promise<Response>) {
      const abort = new AbortController();
      const due = performance.now() + deadlineMs;
      let expired: Response | undefined;
      const expire = () => {
        if (expired !== undefined) return expired;
        const message = `Request exceeded the ${String(deadlineMs)} ms deadline.`;
        expired = new Response(message, {
          status: 503,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
            "Retry-After": "1",
          },
        });
        report(`${req.method} ${JSON.stringify(pathname)}: ${message}`);
        abort.abort();
        return expired;
      };
      // Start the timer before the handler runs. Check the elapsed time on
      // completion too, since synchronous work can delay the timer itself.
      const timer = new AbortController();
      const deadline = Effect.runPromise(Effect.sleep(deadlineMs), { signal: timer.signal }).then(
        expire,
      );
      const pending = requests.run(() => Promise.resolve().then(() => handle(abort.signal)));
      return Promise.race([
        deadline,
        pending.then((response) => (performance.now() >= due ? expire() : response)),
      ]).finally(() => timer.abort());
    },
    /** How many requests' work is still running, an overrun one's included. */
    inFlight() {
      return requests.snapshot().inFlight;
    },
    response() {
      return Response.json(
        {
          ...requests.snapshot(),
          eventLoopLagMs: Math.max(eventLoopLagMs, Math.round(performance.now() - nextSample)),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    },
    settle() {
      return Effect.runPromise(Fiber.interrupt(sample)).then(requests.settle);
    },
  };
}
