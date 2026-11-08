/**
 * Setting up and connecting a sync service, the host half of the setup
 * wizard (`@kb/routines` → setup.ts reads where a person is; this does what
 * needs the host). Every action here that writes is one a person makes:
 * each declares `approval: "required"`, so an agent's call is refused.
 *
 * - **Client.** A pasted client id and secret are checked with Google, then
 *   kept in the host's secret store at references the host chooses for the
 *   account (`SecretStore.place`), never at a reference a node names: a node
 *   is data anyone may have written, so it cannot steer a write. The account
 *   then names those references.
 * - **Connect.** The account's binding (its references) must be trusted
 *   here; the page grants that as the person presses Connect. Google sends
 *   the person back to `CONNECT_PATH` at the public origin, and the page
 *   there hands that URL to `finish`, which finds the attempt by its state.
 * - **Provision.** A calendar on a connected account gets its own Google
 *   calendar, made by kb, under its trusted binding.
 * - **Remove.** The refresh token is revoked at Google, and what the host
 *   placed for the account is erased.
 */
import { Clock, DateTime, Effect, Result } from "effect";
import { onWire, type SecretStore, type UiHostService } from "@kb/contracts";
import { formatSecretRef, typeRefsOf, type SecretRef } from "@kb/model";
import {
  CONNECT_PATH,
  readAccount,
  readCalendar,
  ROUTINE_FIELDS as F,
  ROUTINE_TAGS as T,
  SyncError,
} from "@kb/routines";
import { accountBindingDigest, calendarBindingDigest } from "./binding.ts";
import type { RoutineHost } from "./graph.ts";
import type { ConnectStep, RoutinesPluginOptions } from "./plugin.ts";

/** How long an attempt waits for Google to send the person back. */
const CONNECT_MS = 600_000;
const ACCOUNT_SECRETS = ["client-id", "client-secret", "refresh-token"] as const;

/** The nodes setup reads and writes: an account, a calendar's binding, and either's digest. */
function setupGraph(ui: UiHostService, host: RoutineHost) {
  const write = Effect.fn("routines.setup.write")(function* (input: Record<string, unknown>) {
    const receipt = yield* ui.invoke(
      onWire(
        { actor: "agent", carriesApproval: false },
        { id: "node.update", via: "ext.routines.connect", input },
      ),
    );
    if (receipt.status === "failed")
      return yield* new SyncError({ status: 500, code: "graph_unavailable" });
    return undefined;
  });
  const tagged = Effect.fn("routines.setup.node")(function* (id: string, tag: string) {
    const node = (yield* host.read).get(id);
    if (node === undefined || !typeRefsOf(node).includes(tag))
      return yield* new SyncError({ status: 404, code: "not_found" });
    return node;
  });
  const accountOf = Effect.fn("routines.setup.account")(function* (id: string) {
    const node = yield* tagged(id, T.account);
    return yield* Effect.try({
      try: () => readAccount(node),
      catch: () => new SyncError({ status: 400, code: "invalid_binding" }),
    });
  });
  const bindingFor = Effect.fn("routines.binding.read")(function* (id: string) {
    const nodes = yield* host.read;
    const node = yield* tagged(id, T.calendar);
    return yield* Effect.try({
      try: () => {
        const calendar = readCalendar(node);
        const account = nodes.get(calendar.account);
        return { calendar, account: account === undefined ? null : readAccount(account) };
      },
      catch: () => new SyncError({ status: 400, code: "invalid_binding" }),
    });
  });
  /** The trust digest of a calendar's binding or an account's, whichever `id` is. */
  const digestOf = Effect.fn("routines.binding.digest")(function* (id: string) {
    const node = (yield* host.read).get(id);
    if (node !== undefined && typeRefsOf(node).includes(T.account))
      return yield* accountBindingDigest(yield* accountOf(id));
    return yield* calendarBindingDigest(yield* bindingFor(id));
  });
  return { write, accountOf, bindingFor, digestOf };
}

/** Where the host keeps `secret` for `account`: its own choice, never a node's. */
const placed = (
  secrets: SecretStore,
  account: string,
  secret: (typeof ACCOUNT_SECRETS)[number],
): SecretRef => secrets.place(`routines.${account.replaceAll(/[^A-Za-z0-9._-]/g, "-")}.${secret}`);

/**
 * Check a client with Google, keep it at the host's own references for the
 * account, and point the account at them; the refresh token kept for an
 * earlier client is erased, since it refreshes with no other.
 */
function keepClient(
  options: RoutinesPluginOptions,
  write: ReturnType<typeof setupGraph>["write"],
  accountOf: ReturnType<typeof setupGraph>["accountOf"],
  redirectUri: string,
) {
  return Effect.fn("routines.setup.client")(function* (
    id: string,
    client: { readonly id: string; readonly secret: string },
  ) {
    yield* accountOf(id);
    yield* options.setup.validate(client, redirectUri);
    const refs = {
      clientId: placed(options.secrets, id, "client-id"),
      clientSecret: placed(options.secrets, id, "client-secret"),
      refreshToken: placed(options.secrets, id, "refresh-token"),
    };
    const kept = new SyncError({ status: 500, code: "secret_not_kept" });
    yield* options.secrets
      .sink(refs.clientId)
      .write(client.id)
      .pipe(Effect.mapError(() => kept));
    yield* options.secrets
      .sink(refs.clientSecret)
      .write(client.secret)
      .pipe(Effect.mapError(() => kept));
    // A refresh token issued to another client does not refresh with this one.
    yield* options.secrets.sink(refs.refreshToken).erase.pipe(Effect.mapError(() => kept));
    const fields = [F.clientId, F.clientSecret, F.refreshToken, F.status, F.message];
    yield* write({
      id,
      unsetProps: fields.map((field) => ({ field })),
      setProps: [
        { field: F.clientId, value: { t: "str", v: formatSecretRef(refs.clientId) } },
        { field: F.clientSecret, value: { t: "str", v: formatSecretRef(refs.clientSecret) } },
        { field: F.refreshToken, value: { t: "str", v: formatSecretRef(refs.refreshToken) } },
      ],
    });
    return { ok: true };
  });
}

export function connections(options: RoutinesPluginOptions, ui: UiHostService, host: RoutineHost) {
  const connecting = new Map<
    string,
    { account: string; digest: string; step: ConnectStep; at: number }
  >();
  const redirectUri = new URL(CONNECT_PATH, options.origin).toString();
  const { write, accountOf, bindingFor, digestOf } = setupGraph(ui, host);
  const info = Effect.gen(function* () {
    return {
      redirectUri,
      origin: new URL(options.origin).origin,
      store: yield* options.secrets.describe,
      automation: yield* options.setup.automation,
    };
  });

  const saveClient = keepClient(options, write, accountOf, redirectUri);

  const connect = Effect.fn("routines.connect")(function* (id: string) {
    const account = yield* accountOf(id);
    const digest = yield* accountBindingDigest(account);
    const at = yield* Clock.currentTimeMillis;
    for (const [state, attempt] of connecting)
      if (attempt.account === id || attempt.at + CONNECT_MS <= at) connecting.delete(state);
    const step = yield* options.setup.connect(account, host.trusted(digest), redirectUri);
    connecting.set(step.state, { account: id, digest, step, at });
    return { url: step.url };
  });

  const finish = Effect.fn("routines.finish")(function* (redirect: string) {
    const state = URL.canParse(redirect) ? new URL(redirect).searchParams.get("state") : null;
    const attempt = state === null ? undefined : connecting.get(state);
    if (state === null || attempt === undefined)
      return yield* new SyncError({ status: 401, code: "connect_expired" });
    const account = yield* accountOf(attempt.account);
    if ((yield* accountBindingDigest(account)) !== attempt.digest) {
      connecting.delete(state);
      return yield* new SyncError({ status: 409, code: "binding_changed" });
    }
    const done = yield* Effect.result(attempt.step.finish(redirect));
    // A wrong redirect leaves the attempt to the right one; anything else ends it.
    if (Result.isSuccess(done) || done.failure.code !== "connect_invalid") connecting.delete(state);
    const now = DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));
    if (Result.isFailure(done)) {
      if (done.failure.code !== "connect_invalid")
        yield* host.status(account.id, {
          state: "error",
          message: `Connecting failed (${done.failure.code.replaceAll("_", " ")})`,
          at: now,
        });
      return yield* done.failure;
    }
    yield* host.status(account.id, { state: "synced", message: "", at: now });
    return { account: account.id };
  });

  const provision = Effect.fn("routines.provision")(function* (id: string) {
    const binding = yield* bindingFor(id);
    const digest = yield* calendarBindingDigest(binding);
    if (!(yield* host.trusted(digest)))
      return yield* new SyncError({ status: 403, code: "untrusted" });
    if (binding.calendar.calendarId === "") {
      const client = yield* options.client(binding, host.trusted(digest));
      const calendarId = yield* client.create(
        binding.calendar.name === "" ? "kb routines" : binding.calendar.name,
        binding.calendar.zone,
      );
      yield* write({
        id,
        unsetProps: [{ field: F.calendarId }],
        setProps: [{ field: F.calendarId, value: { t: "str", v: calendarId } }],
      });
    }
    return { digest: yield* calendarBindingDigest(yield* bindingFor(id)) };
  });

  const remove = Effect.fn("routines.remove")(function* (id: string) {
    const account = yield* accountOf(id);
    const trusted = host.trusted(yield* accountBindingDigest(account));
    // Revoking needs the token, read only under trust; an untrusted or unset one is skipped.
    const revoked = yield* Effect.result(options.setup.revoke(account, trusted));
    for (const secret of ACCOUNT_SECRETS)
      yield* options.secrets
        .sink(placed(options.secrets, id, secret))
        .erase.pipe(Effect.mapError(() => new SyncError({ status: 500, code: "secret_not_kept" })));
    return { revoked: Result.isSuccess(revoked) };
  });

  return { info, digestOf, saveClient, connect, finish, provision, remove };
}
export type Connections = ReturnType<typeof connections>;
