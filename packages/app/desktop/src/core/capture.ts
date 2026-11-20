/**
 * The desktop's half of the capture wire. Pairing: a remote store's host
 * trades a one-use code its owner issued (`capture.pairCode`) for this
 * device's credential (`capture.pair`). Quick capture: the desktop sends
 * what the person typed, as typed, to the store's host as one
 * `capture.submit` call, as the holder of that credential, and the host
 * maps it to nodes and places it (its capture target: today's day by
 * default). The desktop does no graph writes of its own. The contract is
 * the backend's (DESIGN.md → Action registry, `capture.submit`); this
 * module only builds the calls and reads the receipts.
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
  const refused = answer.message ?? "the host refused the capture";
  if (answer.code === "forbidden") return { ok: false, message: `${refused}. ${REPAIR}` };
  return { ok: false, message: refused };
}

/** What to do when a host no longer takes this device's credential. */
const REPAIR =
  "Pair this store again: forget it in Stores, and add it with a new code from its host.";

/** Call `id` with `input` on `host`'s action endpoint, as a program (no Origin), with its credential when it has one. */
const callAction = Effect.fn("kb.desktop.capture.call")(function* (
  host: CaptureHost,
  id: string,
  input: unknown,
): Effect.fn.Return<unknown, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (host.token !== undefined) headers.authorization = `Bearer ${host.token}`;
  const res = yield* Effect.tryPromise({
    try: (signal) =>
      fetch(new URL("/api/action", host.origin), {
        method: "POST",
        headers,
        body: JSON.stringify({ id, input }),
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
  if (body === null) return yield* Effect.fail(`the host answered HTTP ${res.status}`);
  return body;
});

// GAP [[01M7QTTTHGVFE32XRVV96A696K]]: the pair receipt is declared here, beside the envelope, until the desktop imports @kb/contracts.
/** What `capture.pair` answers. */
const PairAnswerSchema = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("succeeded"),
    output: Schema.Struct({
      token: Schema.String,
      deviceId: Schema.String,
      store: Schema.Struct({ key: Schema.String, name: Schema.String }),
      captureContract: Schema.optionalKey(Schema.Finite),
    }),
  }),
  Schema.Struct({
    status: Schema.Literal("failed"),
    code: Schema.optionalKey(Schema.String),
    message: Schema.optionalKey(Schema.String),
  }),
]);
const decodePairAnswer = Schema.decodeUnknownOption(PairAnswerSchema);

/** A pairing: this device's credential for a store, and the capture contracts its host accepts. */
export type PairOutcome =
  | {
      readonly ok: true;
      readonly token: string;
      readonly deviceId: string;
      readonly store: { readonly key: string; readonly name: string };
      readonly accepts: readonly number[];
    }
  | { readonly ok: false; readonly message: string };

/** Read a `capture.pair` answer as a pairing. */
export function pairOutcome(body: unknown): PairOutcome {
  const answer = Option.getOrUndefined(decodePairAnswer(body));
  if (answer === undefined)
    return { ok: false, message: "the host answered something that is not a pairing" };
  if (answer.status === "succeeded") {
    const { token, deviceId, store, captureContract } = answer.output;
    return {
      ok: true,
      token,
      deviceId,
      store,
      accepts: captureContract === undefined ? [] : [captureContract],
    };
  }
  if (answer.code === "unknown_action")
    return { ok: false, message: "this store's kb has no capture.pair yet; update kb on its host" };
  return { ok: false, message: answer.message ?? "the host refused the pairing" };
}

/**
 * Trade a one-use pairing `code` at the host at `origin` for this device's
 * credential, naming the device `deviceName` there. Never fails: a host
 * that cannot be reached is an outcome with the reason.
 */
export const pairWithHost = Effect.fn("kb.desktop.capture.pair")(
  function* (origin: string, code: string, deviceName: string) {
    return pairOutcome(yield* callAction({ origin }, "capture.pair", { code, deviceName }));
  },
  Effect.catch((message: string) => Effect.succeed<PairOutcome>({ ok: false, message })),
);

/** How the app pairs with a host: the real call, or a stand-in in tests. */
export type PairWithHost = (
  origin: string,
  code: string,
  deviceName: string,
) => Effect.Effect<PairOutcome>;

/** Whether a host that accepts `accepts` takes this desktop's captures, in words, as the store list shows it. */
export function contractStatus(accepts: readonly number[]): string {
  if (accepts.length === 0)
    return `Capture contract not confirmed yet (this app sends v${CAPTURE_CONTRACT})`;
  if (accepts.includes(CAPTURE_CONTRACT))
    return `Accepts v${CAPTURE_CONTRACT} · in step with this app`;
  return `Accepts ${accepts.map((v) => `v${v}`).join(", ")}; this app sends v${CAPTURE_CONTRACT}, so captures are refused`;
}

/**
 * Send `capture` to `host` and read its receipt. A retry with the same
 * `captureId` returns the first receipt (the host is idempotent on it), so a
 * caller that lost the answer may send it again. Never fails: a host that
 * cannot be reached is an outcome with the reason.
 */
export const submitCapture = Effect.fn("kb.desktop.capture.submit")(
  function* (host: CaptureHost, capture: RawCapture) {
    return captureOutcome(yield* callAction(host, "capture.submit", capture));
  },
  Effect.catch((message: string) => Effect.succeed<CaptureOutcome>({ ok: false, message })),
);

/** How the app submits a capture: the real host call, or a stand-in in tests. */
export type SubmitCapture = (
  host: CaptureHost,
  capture: RawCapture,
) => Effect.Effect<CaptureOutcome>;
