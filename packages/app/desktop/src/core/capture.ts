/**
 * Quick capture's half of the raw capture contract: the desktop sends what
 * the person typed, as typed, to the store's host as one `capture.submit`
 * call, and the host maps it to nodes and places it (its capture target:
 * today's day by default). The desktop does no graph writes of its own. The
 * contract is the backend's (DESIGN.md → Action registry, `capture.submit`);
 * this module only builds the envelope and reads the receipt.
 */
import { DateTime, Effect, Option, Schema } from "effect";

// GAP [[01M7QTTTHGVFE32XRVV96A696K]]: the envelope is declared here until @kb/contracts' CaptureSubmit is on main.
/** The contract version this desktop speaks. */
export const CAPTURE_CONTRACT = 1;

/** A raw capture, as the host's `capture.submit` takes it. */
export interface RawCapture {
  readonly version: typeof CAPTURE_CONTRACT;
  readonly captureId: string;
  /** When the person captured it, with their UTC offset. */
  readonly capturedAt: string;
  readonly source: { readonly app: string };
  readonly text: string;
}

/** What a submission came to: the node the host made, or why it did not. */
export type CaptureOutcome =
  | { readonly ok: true; readonly nodeId: string; readonly store: string }
  | { readonly ok: false; readonly message: string };

/** `at` as an ISO-8601 time in this machine's zone, with its offset (`2026-11-18T23:04:05.123+07:00`). */
export function localIsoTime(at: DateTime.DateTime): string {
  return DateTime.formatIsoOffset(DateTime.setZone(at, DateTime.zoneMakeLocal()));
}

/** The raw capture of `text`, typed `at`. */
export function textCapture(text: string, at: DateTime.DateTime, captureId: string): RawCapture {
  return {
    version: CAPTURE_CONTRACT,
    captureId,
    capturedAt: localIsoTime(at),
    source: { app: "kb desktop" },
    text,
  };
}

/** Where a capture goes: the host's origin, and the credential a remote host asks for. */
export interface CaptureHost {
  readonly origin: string;
  readonly token?: string;
}

/** What `/api/action` answers to a `capture.submit` call. */
const CaptureAnswerSchema = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("succeeded"),
    output: Schema.Struct({ nodeId: Schema.String, store: Schema.optionalKey(Schema.String) }),
  }),
  Schema.Struct({
    status: Schema.Literal("failed"),
    code: Schema.optionalKey(Schema.String),
    message: Schema.optionalKey(Schema.String),
  }),
]);
const decodeAnswer = Schema.decodeUnknownOption(CaptureAnswerSchema);

/** Read a `/api/action` answer as an outcome. */
export function captureOutcome(body: unknown): CaptureOutcome {
  const answer = Option.getOrUndefined(decodeAnswer(body));
  if (answer === undefined)
    return { ok: false, message: "the host answered something that is not a receipt" };
  if (answer.status === "succeeded")
    return { ok: true, nodeId: answer.output.nodeId, store: answer.output.store ?? "" };
  if (answer.code === "unknown_action")
    return {
      ok: false,
      message: `this store's kb has no capture.submit yet (it needs capture contract ${CAPTURE_CONTRACT}); update kb`,
    };
  return { ok: false, message: answer.message ?? "the host refused the capture" };
}

/**
 * Send `capture` to `host` and read its receipt. A retry with the same
 * `captureId` returns the first receipt (the host is idempotent on it), so a
 * caller that lost the answer may send it again. Never fails: a host that
 * cannot be reached is an outcome with the reason.
 */
export const submitCapture = Effect.fn("kb.desktop.capture.submit")(
  function* (host: CaptureHost, capture: RawCapture): Effect.fn.Return<CaptureOutcome, string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (host.token !== undefined) headers.authorization = `Bearer ${host.token}`;
    const res = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(new URL("/api/action", host.origin), {
          method: "POST",
          headers,
          body: JSON.stringify({ id: "capture.submit", input: capture }),
          signal,
        }),
      catch: (err) =>
        `could not reach ${host.origin}: ${err instanceof Error ? err.message : String(err)}`,
    }).pipe(
      Effect.timeoutOrElse({
        duration: "15 seconds",
        orElse: () => Effect.fail(`${host.origin} did not answer`),
      }),
    );
    const body: unknown = yield* Effect.promise(() => res.json().catch(() => null));
    if (body === null) return { ok: false, message: `the host answered HTTP ${res.status}` };
    return captureOutcome(body);
  },
  Effect.catch((message: string) => Effect.succeed<CaptureOutcome>({ ok: false, message })),
);

/** How the app submits a capture: the real host call, or a stand-in in tests. */
export type SubmitCapture = (
  host: CaptureHost,
  capture: RawCapture,
) => Effect.Effect<CaptureOutcome>;
