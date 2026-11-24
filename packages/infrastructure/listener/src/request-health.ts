/**
 * A host's HTTP requests, each held to a deadline (DESIGN.md → Surfaces →
 * MCP; kb ui's server): a handler that overruns it is aborted and answered,
 * 503 to retry if it never reached a commit and an unknown outcome if it
 * may have (`HeldRequest`), and its work is tracked until it settles, so the host closes its
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
 * What a handler is given: the `signal` that aborts it at the deadline, and
 * `committing`, which it calls once a commit may have begun (when a write
 * takes its lock, `WriteLockTaken`), with the answer to give if the deadline
 * comes before its own. From then on the deadline answers that, or
 * {@link unknownOutcome}, and never that a retry is safe.
 */
export interface HeldRequest {
  readonly signal: AbortSignal;
  readonly committing: (answer?: Response) => void;
}

const NO_STORE = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };

/** The deadline's answer to a request that never reached a commit: nothing was written, so retry. */
function retryable(deadlineMs: number): Response {
  return new Response(`Request exceeded the ${String(deadlineMs)} ms deadline.`, {
    status: 503,
    headers: { ...NO_STORE, "Retry-After": "1" },
  });
}

/**
 * The deadline's answer to a request whose commit may have begun: whether
 * it landed is unknown, so it says to look rather than to retry.
 */
function unknownOutcome(deadlineMs: number): Response {
  return new Response(
    `Request exceeded the ${String(deadlineMs)} ms deadline after its write may have begun to commit, so whether it landed is unknown; read graph.changes before retrying.`,
    { status: 504, headers: NO_STORE },
  );
}

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
    run(req: Request, pathname: string, handle: (held: HeldRequest) => Promise<Response>) {
      const abort = new AbortController();
      let unknown: Response | undefined;
      const committing = (answer?: Response) => {
        unknown ??= answer ?? unknownOutcome(deadlineMs);
      };
      const expire = () => {
        const answer = unknown ?? retryable(deadlineMs);
        const outcome = unknown === undefined ? "" : " after it may have begun to commit";
        report(
          `${req.method} ${JSON.stringify(pathname)}: Request exceeded the ${String(deadlineMs)} ms deadline${outcome}.`,
        );
        abort.abort();
        return answer;
      };
      // The timer starts before the handler runs. A response the handler
      // finished is the answer, whatever the clock says by then.
      const timer = new AbortController();
      const deadline = Effect.runPromise(Effect.sleep(deadlineMs), { signal: timer.signal }).then(
        expire,
      );
      const pending = requests.run(() =>
        Promise.resolve().then(() => handle({ signal: abort.signal, committing })),
      );
      return Promise.race([deadline, pending]).finally(() => timer.abort());
    },
    /** How long a request may run before its deadline answers it. */
    deadlineMs,
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
