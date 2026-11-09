import { Clock, Effect, Option, Result, Schema, Semaphore } from "effect";
import type { SecretSink, SecretSource } from "@kb/contracts";
import { parseSecretRef } from "@kb/model";
import { SyncError, type AccountConfig } from "@kb/routines";
import { readJson, boundedNetwork, type GoogleTokens } from "./http.ts";

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
const Token = Schema.Struct({
  access_token: Schema.String,
  expires_in: Schema.Int,
  refresh_token: Schema.optionalKey(Schema.String),
});
const auth = () => new SyncError({ status: 401, code: "auth_needed" });
const TokenError = Schema.Struct({ error: Schema.String });
/**
 * What the token endpoint's `error` says, as kb's codes: a client Google
 * does not know or whose secret is wrong, one deleted, one of a type that
 * may not use this grant, a redirect URI the client does not list, and a
 * grant (a code or a refresh token) that is not good. The body's
 * description is never kept; it may quote what was sent.
 */
const TOKEN_ERRORS: Readonly<Record<string, string>> = {
  invalid_client: "client_invalid",
  deleted_client: "client_deleted",
  unauthorized_client: "client_type",
  redirect_uri_mismatch: "redirect_mismatch",
  invalid_grant: "auth_needed",
};
export interface OAuthOptions {
  readonly account: AccountConfig;
  readonly secrets: SecretSource;
  readonly sink: (reference: string) => SecretSink;
  readonly trusted: Effect.Effect<boolean, SyncError>;
  readonly fetch?: typeof fetch;
}
const secret = Effect.fn("routines.oauth.secret")(function* (
  source: SecretSource,
  reference: string,
) {
  const parsed = parseSecretRef(reference);
  if (parsed === null) return yield* auth();
  return yield* source.resolve(parsed).pipe(Effect.mapError(auth));
});
const googlePost = Effect.fn("routines.oauth.post")(function* (
  fetcher: typeof fetch,
  url: string,
  body: URLSearchParams,
) {
  return yield* boundedNetwork(
    Effect.tryPromise({
      try: (signal) => fetcher(url, { method: "POST", redirect: "error", body, signal }),
      catch: () => new SyncError({ status: 0, code: "offline" }),
    }),
  );
});
const tokenRequest = Effect.fn("routines.oauth.tokenRequest")(function* (
  fetcher: typeof fetch,
  body: URLSearchParams,
) {
  const response = yield* googlePost(fetcher, "https://oauth2.googleapis.com/token", body);
  if (!response.ok) {
    if (response.status >= 500)
      return yield* new SyncError({ status: response.status, code: "upstream" });
    const raw = yield* readJson(response).pipe(Effect.orElseSucceed(() => null));
    const error = Schema.decodeUnknownOption(TokenError)(raw);
    const code = Option.isSome(error) ? TOKEN_ERRORS[error.value.error] : undefined;
    return yield* new SyncError({ status: 401, code: code ?? "auth_needed" });
  }
  const raw = yield* readJson(response);
  return yield* Schema.decodeUnknownEffect(Token)(raw).pipe(Effect.mapError(auth));
});

/** A Google OAuth client id, as the Console shows it. */
export const GOOGLE_CLIENT_ID = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;

/**
 * Whether Google accepts `client` as a client of its own, before kb keeps
 * it: a real call to the token endpoint with a code no one issued. Google
 * checks the client first, so `invalid_grant` (the code) means the id and
 * secret are good, and a client it does not know, a wrong secret, a deleted
 * client or one that may not use this grant fails with what is wrong. The
 * values are sent only to Google, and appear in no error.
 */
export const validateGoogleClient = Effect.fn("routines.oauth.validate")(function* (
  client: { readonly id: string; readonly secret: string },
  redirectUri: string,
  fetcher: typeof fetch = fetch,
) {
  if (!GOOGLE_CLIENT_ID.test(client.id))
    return yield* new SyncError({ status: 400, code: "client_id_format" });
  if (client.secret === "" || /\s/.test(client.secret))
    return yield* new SyncError({ status: 400, code: "client_secret_format" });
  const result = yield* Effect.result(
    tokenRequest(
      fetcher,
      new URLSearchParams({
        client_id: client.id,
        client_secret: client.secret,
        code: "kb-setup-check",
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    ),
  );
  if (Result.isSuccess(result) || result.failure.code === "auth_needed") return undefined;
  return yield* result.failure;
});

/** Revoke the account's refresh token at Google, so removing it here also ends it there. */
export const revokeGoogle = Effect.fn("routines.oauth.revoke")(function* (options: OAuthOptions) {
  if (!(yield* options.trusted)) return yield* new SyncError({ status: 403, code: "untrusted" });
  const token = yield* secret(options.secrets, options.account.refreshToken);
  const response = yield* googlePost(
    options.fetch ?? fetch,
    "https://oauth2.googleapis.com/revoke",
    new URLSearchParams({ token }),
  );
  // 400 is a token Google no longer holds: already ended, which is what was asked.
  if (!response.ok && response.status !== 400)
    return yield* new SyncError({ status: response.status, code: "upstream" });
  return undefined;
});

/** Secrets are resolved only inside a trusted request and are never returned. */
export const makeGoogleTokens = Effect.fn("routines.oauth.tokens")(function* (
  options: OAuthOptions,
) {
  let cached: { token: string; until: number } | null = null;
  const lock = yield* Semaphore.make(1);
  const refresh = Effect.gen(function* () {
    if (!(yield* options.trusted)) return yield* new SyncError({ status: 403, code: "untrusted" });
    const client = yield* secret(options.secrets, options.account.clientId);
    const clientSecret = yield* secret(options.secrets, options.account.clientSecret);
    const refreshToken = yield* secret(options.secrets, options.account.refreshToken);
    const token = yield* tokenRequest(
      options.fetch ?? fetch,
      new URLSearchParams({
        client_id: client,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    );
    if (token.refresh_token !== undefined)
      yield* options
        .sink(options.account.refreshToken)
        .write(token.refresh_token)
        .pipe(Effect.mapError(auth));
    cached = {
      token: token.access_token,
      until: (yield* Clock.currentTimeMillis) + Math.max(0, token.expires_in - 60) * 1000,
    };
    return undefined;
  });
  const access = lock.withPermit(
    Effect.gen(function* () {
      if (!(yield* options.trusted))
        return yield* new SyncError({ status: 403, code: "untrusted" });
      if (cached === null || cached.until <= (yield* Clock.currentTimeMillis)) yield* refresh;
      if (cached === null) return yield* auth();
      return cached.token;
    }),
  );
  return { access, refresh: lock.withPermit(refresh) } satisfies GoogleTokens;
});

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

/** How long a person has to answer Google's consent page. */
const CONSENT_MS = 600_000;

/**
 * Start connecting an account: a one-shot PKCE authorization request that
 * Google answers by sending the person's browser to `redirectUri`, kb's own
 * page, which hands the URL it was opened at to `finish`. `state` names
 * this attempt (the host finds it again by it); `finish` accepts only a URL
 * at exactly `redirectUri` with this state, once, within ten minutes, while
 * the account's binding is still trusted, and only then exchanges the code
 * with the PKCE verifier and keeps the refresh token through the account's
 * bound sink. A redirect carrying Google's `error` (the person declined)
 * ends the attempt with `consent_denied`.
 */
export const beginGoogleConnect = Effect.fn("routines.oauth.begin")(function* (
  options: OAuthOptions,
  redirectUri: string,
) {
  if (!(yield* options.trusted)) return yield* new SyncError({ status: 403, code: "untrusted" });
  if (parseSecretRef(options.account.refreshToken) === null) return yield* auth();
  const client = yield* secret(options.secrets, options.account.clientId);
  const state = base64Url(crypto.getRandomValues(new Uint8Array(24)));
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = yield* Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  const started = yield* Clock.currentTimeMillis;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  for (const [key, value] of Object.entries({
    client_id: client,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: CALENDAR_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: base64Url(new Uint8Array(digest)),
    code_challenge_method: "S256",
    ...(options.account.email === "" ? {} : { login_hint: options.account.email }),
  }))
    url.searchParams.set(key, value);
  let consumed = false;
  const finish = Effect.fn("routines.oauth.finish")(function* (redirect: string) {
    if (consumed || (yield* Clock.currentTimeMillis) > started + CONSENT_MS)
      return yield* new SyncError({ status: 401, code: "connect_expired" });
    const callback = yield* Effect.try({
      try: () => new URL(redirect),
      catch: () => new SyncError({ status: 400, code: "connect_invalid" }),
    });
    if (
      callback.origin + callback.pathname !== redirectUri ||
      callback.searchParams.get("state") !== state
    )
      return yield* new SyncError({ status: 400, code: "connect_invalid" });
    consumed = true;
    if (callback.searchParams.has("error"))
      return yield* new SyncError({ status: 401, code: "consent_denied" });
    const code = callback.searchParams.get("code");
    if (code === null || code === "")
      return yield* new SyncError({ status: 400, code: "connect_invalid" });
    if (!(yield* options.trusted)) return yield* new SyncError({ status: 403, code: "untrusted" });
    const clientSecret = yield* secret(options.secrets, options.account.clientSecret);
    const token = yield* tokenRequest(
      options.fetch ?? fetch,
      new URLSearchParams({
        client_id: client,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        grant_type: "authorization_code",
      }),
    );
    if (token.refresh_token === undefined)
      return yield* new SyncError({ status: 401, code: "no_refresh_token" });
    yield* options
      .sink(options.account.refreshToken)
      .write(token.refresh_token)
      .pipe(Effect.mapError(() => new SyncError({ status: 500, code: "secret_not_kept" })));
    return undefined;
  });
  return { url: url.toString(), state, finish };
});
