import { expect, test } from "bun:test";
import { Effect, Result, type Scope } from "effect";
import { TestClock } from "effect/testing";
import type { SyncError } from "@kb/routines";
import { SecretError } from "@kb/contracts";
import {
  beginGoogleConnect,
  makeGoogleTokens,
  revokeGoogle,
  validateGoogleClient,
  CALENDAR_SCOPE,
  type OAuthOptions,
} from "../src/index.ts";

const REDIRECT = "https://kb.test/calendar/connect";

function fixture() {
  let trusted = true;
  const calls: URLSearchParams[] = [];
  const writes: string[] = [];
  const reads: string[] = [];
  let revoked = false;
  const options: OAuthOptions = {
    account: {
      id: "account",
      email: "owner@test",
      clientId: "env:CLIENT",
      clientSecret: "env:SECRET",
      refreshToken: "dotenv:/private/google.env#TOKEN",
    },
    trusted: Effect.sync(() => trusted),
    secrets: {
      resolve: (reference) =>
        Effect.gen(function* () {
          reads.push(reference.kind);
          if (reference.kind === "env")
            return reference.name === "CLIENT" ? "desktop-client" : "desktop-secret";
          if (reference.kind === "dotenv") return "saved-refresh";
          return yield* new SecretError({ message: "unsupported fixture reference" });
        }),
    },
    sink: (reference) => ({
      write: (value) =>
        Effect.sync(() => {
          expect(reference).toBe(options.account.refreshToken);
          writes.push(value);
        }),
      erase: Effect.die("the connect flow never erases"),
    }),
    fetch: Object.assign(
      (input: string | URL | Request, init?: RequestInit) => {
        expect(input instanceof Request ? input.url : input.toString()).toBe(
          "https://oauth2.googleapis.com/token",
        );
        expect(init?.redirect).toBe("error");
        if (!(init?.body instanceof URLSearchParams)) throw new Error("expected form body");
        calls.push(new URLSearchParams(init.body));
        return Promise.resolve(
          new Response(
            JSON.stringify(
              revoked
                ? { error: "invalid_grant", error_description: "NEVER_LOG_THIS" }
                : {
                    access_token: "access-secret",
                    refresh_token: "rotated-secret",
                    expires_in: 3600,
                  },
            ),
            { status: revoked ? 400 : 200 },
          ),
        );
      },
      { preconnect: fetch.preconnect },
    ),
  };
  return {
    options,
    calls,
    writes,
    reads,
    trust: (value: boolean) => {
      trusted = value;
    },
    revoke: () => {
      revoked = true;
    },
  };
}
function effectTest(name: string, run: Effect.Effect<void, SyncError, Scope.Scope>) {
  test(name, () => Effect.runPromise(Effect.scoped(run).pipe(Effect.provide(TestClock.layer()))));
}
effectTest(
  "tokens require trust before resolving secrets; refresh rotates only the bound sink",
  Effect.gen(function* () {
    const f = fixture();
    const tokens = yield* makeGoogleTokens(f.options);
    f.trust(false);
    expect(Result.isFailure(yield* Effect.result(tokens.access))).toBe(true);
    expect(f.reads).toHaveLength(0);
    expect(f.calls).toHaveLength(0);
    f.trust(true);
    const accesses = yield* Effect.all([tokens.access, tokens.access], { concurrency: 2 });
    expect(accesses).toEqual(["access-secret", "access-secret"]);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.get("refresh_token")).toBe("saved-refresh");
    expect(f.writes).toEqual(["rotated-secret"]);
    yield* TestClock.adjust("1 hour");
    yield* tokens.access;
    expect(f.calls).toHaveLength(2);
    f.revoke();
    const failed = yield* Effect.result(tokens.refresh);
    expect(Result.isFailure(failed) ? failed.failure.code : "success").toBe("auth_needed");
    expect(JSON.stringify(failed)).not.toContain("NEVER_LOG_THIS");
  }),
);
effectTest(
  "connect sends the person to Google with PKCE and the redirect URI, and finishes once, by state",
  Effect.gen(function* () {
    const f = fixture();
    const step = yield* beginGoogleConnect(f.options, REDIRECT);
    const url = new URL(step.url);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("scope")).toBe(CALENDAR_SCOPE);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(url.searchParams.get("login_hint")).toBe("owner@test");
    expect(url.searchParams.get("state")).toBe(step.state);
    expect(step.state.length).toBeGreaterThanOrEqual(32);
    const callback = new URL(REDIRECT);
    callback.searchParams.set("code", "one-shot-code");
    callback.searchParams.set("state", "wrong-state");
    const wrong = yield* Effect.result(step.finish(callback.toString()));
    expect(Result.isFailure(wrong) ? wrong.failure.code : "").toBe("connect_invalid");
    const elsewhere = new URL(callback);
    elsewhere.host = "evil.test";
    elsewhere.searchParams.set("state", step.state);
    expect(Result.isFailure(yield* Effect.result(step.finish(elsewhere.toString())))).toBe(true);
    expect(f.calls).toHaveLength(0);
    callback.searchParams.set("state", step.state);
    f.trust(false);
    expect(Result.isFailure(yield* Effect.result(step.finish(callback.toString())))).toBe(true);
    expect(f.calls).toHaveLength(0);
  }),
);
effectTest(
  "the code is exchanged with the PKCE verifier, the token kept through the bound sink, once",
  Effect.gen(function* () {
    const f = fixture();
    const step = yield* beginGoogleConnect(f.options, REDIRECT);
    const url = new URL(step.url);
    const callback = new URL(REDIRECT);
    callback.searchParams.set("code", "one-shot-code");
    callback.searchParams.set("state", step.state);
    yield* step.finish(callback.toString());
    expect(f.calls[0]?.get("redirect_uri")).toBe(REDIRECT);
    expect(f.calls[0]?.get("code")).toBe("one-shot-code");
    const verifier = f.calls[0]?.get("code_verifier") ?? "";
    const digest = yield* Effect.promise(() =>
      crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    );
    const encoded = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
    expect(encoded).toBe(url.searchParams.get("code_challenge") ?? "");
    expect(f.writes).toEqual(["rotated-secret"]);
    const again = yield* Effect.result(step.finish(callback.toString()));
    expect(Result.isFailure(again) ? again.failure.code : "").toBe("connect_expired");
    expect(f.calls).toHaveLength(1);
  }),
);
effectTest(
  "a declined consent ends the attempt; ten minutes later it has expired",
  Effect.gen(function* () {
    const f = fixture();
    const declined = yield* beginGoogleConnect(f.options, REDIRECT);
    const back = new URL(REDIRECT);
    back.searchParams.set("error", "access_denied");
    back.searchParams.set("state", declined.state);
    const result = yield* Effect.result(declined.finish(back.toString()));
    expect(Result.isFailure(result) ? result.failure.code : "").toBe("consent_denied");
    const late = yield* beginGoogleConnect(f.options, REDIRECT);
    yield* TestClock.adjust("11 minutes");
    const callback = new URL(REDIRECT);
    callback.searchParams.set("code", "c");
    callback.searchParams.set("state", late.state);
    const expired = yield* Effect.result(late.finish(callback.toString()));
    expect(Result.isFailure(expired) ? expired.failure.code : "").toBe("connect_expired");
    expect(f.calls).toHaveLength(0);
  }),
);

/** A token endpoint that answers one `error`, and records what it was sent. */
function tokenEndpoint(status: number, body: unknown) {
  const sent: URLSearchParams[] = [];
  const fetcher = Object.assign(
    (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.body instanceof URLSearchParams) sent.push(new URLSearchParams(init.body));
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    },
    { preconnect: fetch.preconnect },
  );
  return { sent, fetcher };
}
const CLIENT = { id: "1234-abc.apps.googleusercontent.com", secret: "GOCSPX-secret" };

effectTest(
  "a client is checked with a code no one issued: invalid_grant means Google knows it",
  Effect.gen(function* () {
    const good = tokenEndpoint(400, { error: "invalid_grant", error_description: "Bad Request" });
    yield* validateGoogleClient(CLIENT, REDIRECT, good.fetcher);
    expect(good.sent[0]?.get("grant_type")).toBe("authorization_code");
    expect(good.sent[0]?.get("client_id")).toBe(CLIENT.id);
    expect(good.sent[0]?.get("redirect_uri")).toBe(REDIRECT);
    for (const [error, code] of [
      ["invalid_client", "client_invalid"],
      ["deleted_client", "client_deleted"],
      ["unauthorized_client", "client_type"],
      ["redirect_uri_mismatch", "redirect_mismatch"],
    ] as const) {
      const endpoint = tokenEndpoint(401, { error, error_description: "NEVER_LOG_THIS" });
      const result = yield* Effect.result(validateGoogleClient(CLIENT, REDIRECT, endpoint.fetcher));
      expect(Result.isFailure(result) ? result.failure.code : "").toBe(code);
      expect(JSON.stringify(result)).not.toContain("NEVER_LOG_THIS");
      expect(JSON.stringify(result)).not.toContain(CLIENT.secret);
    }
    const down = tokenEndpoint(503, {});
    const result = yield* Effect.result(validateGoogleClient(CLIENT, REDIRECT, down.fetcher));
    expect(Result.isFailure(result) ? result.failure.code : "").toBe("upstream");
  }),
);
effectTest(
  "a malformed client is refused before anything is sent",
  Effect.gen(function* () {
    const endpoint = tokenEndpoint(400, { error: "invalid_grant" });
    for (const [client, code] of [
      [{ ...CLIENT, id: "GOCSPX-pasted-the-secret" }, "client_id_format"],
      [{ ...CLIENT, secret: "" }, "client_secret_format"],
      [{ ...CLIENT, secret: "two words" }, "client_secret_format"],
    ] as const) {
      const result = yield* Effect.result(validateGoogleClient(client, REDIRECT, endpoint.fetcher));
      expect(Result.isFailure(result) ? result.failure.code : "").toBe(code);
    }
    expect(endpoint.sent).toHaveLength(0);
  }),
);
effectTest(
  "revoke reads the refresh token only under trust, and a token Google forgot counts as ended",
  Effect.gen(function* () {
    const f = fixture();
    const ended = tokenEndpoint(400, { error: "invalid_token" });
    f.trust(false);
    const refused = yield* Effect.result(revokeGoogle({ ...f.options, fetch: ended.fetcher }));
    expect(Result.isFailure(refused) ? refused.failure.code : "").toBe("untrusted");
    expect(f.reads).toHaveLength(0);
    f.trust(true);
    yield* revokeGoogle({ ...f.options, fetch: ended.fetcher });
    expect(ended.sent[0]?.get("token")).toBe("saved-refresh");
  }),
);
