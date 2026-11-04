import { Result, Clock, DateTime, Effect, Option, Schema } from "effect";
import { SyncError } from "@kb/routines";

export interface GoogleTokens {
  readonly access: Effect.Effect<string, SyncError>;
  readonly refresh: Effect.Effect<void, SyncError>;
}
export interface GoogleRequest {
  readonly url: string;
  readonly method: "GET" | "POST" | "PUT";
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
}
const ErrorBody = Schema.Struct({
  error: Schema.Struct({
    errors: Schema.optionalKey(Schema.Array(Schema.Struct({ reason: Schema.String }))),
  }),
});
const quotaReasons = new Set([
  "usageLimits",
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "quotaExceeded",
]);
const failureCodes: Readonly<Record<number, string>> = {
  400: "invalid_rule",
  401: "unauthorized",
  403: "auth_needed",
  404: "not_found",
  409: "already_exists",
  410: "deleted",
  412: "precondition_failed",
  429: "quota",
};
const invalidResponse = () => new SyncError({ status: 502, code: "invalid_response" });

export const boundedNetwork = Effect.fn("routines.gcal.boundedNetwork")(function* <A>(
  request: Effect.Effect<A, SyncError>,
): Effect.fn.Return<A, SyncError> {
  return yield* request.pipe(
    Effect.timeoutOrElse({
      duration: "15 seconds",
      orElse: () => Effect.fail(new SyncError({ status: 0, code: "timeout" })),
    }),
  );
});
export const readJson = Effect.fn("routines.gcal.readJson")(function* (response: Response) {
  return yield* boundedNetwork(
    Effect.tryPromise({ try: () => response.json(), catch: invalidResponse }),
  );
});
const responseError = Effect.fn("routines.gcal.responseError")(function* (response: Response) {
  const raw = yield* readJson(response).pipe(Effect.orElseSucceed(() => null));
  const parsed = Schema.decodeUnknownOption(ErrorBody)(raw);
  const quota =
    Option.isSome(parsed) &&
    parsed.value.error.errors?.some((entry) => quotaReasons.has(entry.reason));
  const now = yield* Clock.currentTimeMillis;
  const header = response.headers.get("Retry-After");
  let retryAfter = 0;
  if (header !== null) {
    if (/^\d+$/.test(header) && Number.isFinite(Number(header) * 1000))
      retryAfter = Number(header) * 1000;
    else {
      const time = DateTime.make(header);
      if (Option.isSome(time)) retryAfter = Math.max(0, DateTime.toEpochMillis(time.value) - now);
    }
  }
  return new SyncError({
    status: response.status,
    code: quota === true ? "quota" : (failureCodes[response.status] ?? "upstream"),
    ...(retryAfter > 0 ? { retryAfter } : {}),
  });
});

/** One authorization retry budget covers outer and multipart 401 responses. */
export function googleHttp(tokens: GoogleTokens, fetcher: typeof fetch = fetch) {
  const send = Effect.fn("routines.gcal.send")(function* (token: string, request: GoogleRequest) {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetcher(request.url, {
          method: request.method,
          body: request.body,
          redirect: "error",
          signal,
          headers: { ...request.headers, Authorization: "Bearer " + token },
        }),
      catch: () => new SyncError({ status: 0, code: "offline" }),
    }).pipe(
      Effect.timeoutOrElse({
        duration: "15 seconds",
        orElse: () => Effect.fail(new SyncError({ status: 0, code: "timeout" })),
      }),
    );
    if (!response.ok) return yield* yield* responseError(response);
    return response;
  });
  const authorize = Effect.fn("routines.gcal.authorize")(function* <A>(
    run: (token: string) => Effect.Effect<A, SyncError>,
  ): Effect.fn.Return<A, SyncError> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = yield* tokens.access;
      const result = yield* Effect.result(run(token));
      if (Result.isSuccess(result)) return result.success;
      if (result.failure.status !== 401) return yield* result.failure;
      if (attempt === 0) yield* tokens.refresh;
    }
    return yield* new SyncError({ status: 401, code: "auth_needed" });
  });
  return { send, authorize, responseError };
}
