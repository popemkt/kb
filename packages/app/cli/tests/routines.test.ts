import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Effect, Schema } from "effect";
import { startUi } from "@kb/server";
import { bunFileSystemLayer } from "@kb/runtime";
import {
  makeFakeCalendar,
  routinesExtension,
  ROUTINE_FIELDS as F,
  ROUTINE_TAGS as T,
  routineOption,
  SyncError,
} from "@kb/routines";
import { routinesPlugin } from "@kb/routines-host";
import { SecretError, type SecretStore } from "@kb/contracts";
import { formatSecretRef } from "@kb/model";

/** A secret store in memory: what the host kept, by reference text. */
function memorySecrets() {
  const kept = new Map<string, string>();
  const store: SecretStore = {
    resolve: (ref) => {
      const value = kept.get(formatSecretRef(ref));
      return value === undefined
        ? Effect.fail(new SecretError({ message: "not set" }))
        : Effect.succeed(value);
    },
    place: (name) => ({ kind: "sealed", name }),
    sink: (ref) => ({
      write: (value) => Effect.sync(() => void kept.set(formatSecretRef(ref), value)),
      erase: Effect.sync(() => void kept.delete(formatSecretRef(ref))),
    }),
    describe: Effect.succeed("in memory"),
  };
  return { kept, store };
}

/** Real invoke, graph tail and family lifecycle; Calendar stays in memory. */
test("routines is optional, outline fields preview through real actions, and unload stops its worker", async () => {
  const root = await mkdtemp(join(tmpdir(), "kb-routines-host-"));
  const fake = makeFakeCalendar();
  const secrets = memorySecrets();
  const revoked: string[] = [];
  const handle = await Effect.runPromise(
    startUi({
      root,
      port: 0,
      openBrowser: false,
      extensions: [
        {
          declaration: routinesExtension,
          entry: routinesPlugin({
            origin: "https://kb.test",
            runner: "host-test",
            client: () => Effect.succeed(fake.port),
            secrets: secrets.store,
            setup: {
              validate: (client) =>
                client.secret === "GOCSPX-good"
                  ? Effect.void
                  : Effect.fail(new SyncError({ status: 401, code: "client_invalid" })),
              connect: (account, trusted, redirectUri) =>
                trusted.pipe(
                  Effect.flatMap((allowed) =>
                    allowed
                      ? Effect.succeed({
                          url: "https://consent.test/?redirect_uri=" + redirectUri,
                          state: "state-1",
                          finish: (redirect: string) =>
                            new URL(redirect).searchParams.get("code") === "granted"
                              ? Effect.sync(
                                  () => void secrets.kept.set(account.refreshToken, "refresh"),
                                )
                              : Effect.fail(new SyncError({ status: 401, code: "consent_denied" })),
                        })
                      : Effect.fail(new SyncError({ status: 403, code: "untrusted" })),
                  ),
                ),
              revoke: (account) =>
                Effect.sync(() => void revoked.push(secrets.kept.get(account.refreshToken) ?? "")),
              automation: Effect.succeed({ installed: false, account: null }),
              automate: () => Effect.fail(new SyncError({ status: 0, code: "gcloud_missing" })),
            },
          }),
        },
      ],
    }).pipe(Effect.provide(bunFileSystemLayer)),
  );
  const origin = new URL(handle.url).origin;
  /** A call the page makes (the person's), or a local program's (an agent's) with `agent`. */
  const call = async (id: string, input: unknown, agent = false) => {
    const response = await fetch(origin + "/api/action", {
      method: "POST",
      headers: { ...(agent ? {} : { origin }), "Content-Type": "application/json" },
      body: JSON.stringify({ id, input }),
    });
    return (await response.json()) as { status: string; output?: unknown; message?: string };
  };
  try {
    expect((await call("ext.routines.preview", {})).status).toBe("failed");
    expect(await call("extension.switch", { name: "routines", on: true })).toMatchObject({
      status: "succeeded",
    });
    expect(
      await call("node.add", {
        id: "account",
        text: "Owner",
        tags: [T.account],
        props: [
          { field: F.email, value: { t: "str", v: "owner@example.test" } },
          { field: F.clientId, value: { t: "str", v: "env:TEST_CLIENT" } },
          { field: F.clientSecret, value: { t: "str", v: "env:TEST_SECRET" } },
          { field: F.refreshToken, value: { t: "str", v: "dotenv:/tmp/unused#TOKEN" } },
        ],
      }),
    ).toMatchObject({ status: "succeeded" });
    const calendar = await call("node.add", {
      id: "calendar",
      text: "Calendar",
      tags: [T.calendar],
      props: [
        { field: F.sync, value: { t: "ref", v: routineOption("sync", "preview") } },
        { field: F.account, value: { t: "ref", v: "account" } },
        { field: F.calendarId, value: { t: "str", v: "" } },
      ],
    });
    expect(calendar.status).toBe("succeeded");
    expect(
      await call("node.add", {
        text: "Morning",
        tags: [T.routine],
        props: [
          { field: F.calendar, value: { t: "ref", v: "calendar" } },
          { field: F.starts, value: { t: "str", v: "2026-11-03" } },
          { field: F.at, value: { t: "str", v: "08:00" } },
          { field: F.rrule, value: { t: "str", v: "FREQ=DAILY" } },
        ],
      }),
    ).toMatchObject({ status: "succeeded" });
    const preview = await call("ext.routines.preview", {});
    expect(preview).toMatchObject({
      status: "succeeded",
      output: [
        {
          title: "Morning",
          start: { at: "08:00", zone: "Asia/Ho_Chi_Minh" },
        },
      ],
    });
    expect(fake.events.size).toBe(0);
    expect(await call("ext.routines.setup", {})).toMatchObject({
      status: "succeeded",
      output: {
        redirectUri: "https://kb.test/calendar/connect",
        store: "in memory",
        automation: { installed: false },
      },
    });
    // Keeping a credential and connecting are the person's: an agent is refused.
    const client = { account: "account", clientId: "1-a.apps.googleusercontent.com" };
    expect(
      await call("ext.routines.client", { ...client, clientSecret: "GOCSPX-good" }, true),
    ).toMatchObject({ status: "failed", code: "approval_required" });
    expect(await call("ext.routines.connect", { account: "account" }, true)).toMatchObject({
      status: "failed",
      code: "approval_required",
    });
    expect(
      await call("ext.routines.client", { ...client, clientSecret: "GOCSPX-wrong" }),
    ).toMatchObject({ status: "failed", message: "client_invalid" });
    expect(secrets.kept.size).toBe(0);
    expect(
      await call("ext.routines.client", { ...client, clientSecret: "GOCSPX-good" }),
    ).toMatchObject({ status: "succeeded" });
    // Kept where the host placed them, and the account names those references, not values.
    expect(secrets.kept.get("sealed:routines.account.client-secret")).toBe("GOCSPX-good");
    const account = await call("node.get", { id: "account", depth: 0 });
    expect(account).toMatchObject({
      output: {
        node: {
          props: {
            [F.clientId]: [{ t: "str", v: "sealed:routines.account.client-id" }],
            [F.clientSecret]: [{ t: "str", v: "sealed:routines.account.client-secret" }],
            [F.refreshToken]: [{ t: "str", v: "sealed:routines.account.refresh-token" }],
          },
        },
      },
    });
    expect(JSON.stringify(account)).not.toContain("GOCSPX-good");
    expect((await call("ext.routines.connect", { account: "account" })).status).toBe("failed");
    const digestOf = async (node: string) =>
      Schema.decodeUnknownSync(Schema.Struct({ digest: Schema.String }))(
        (await call("ext.routines.binding", { node })).output,
      );
    expect(await call("sandbox.trust", await digestOf("account"))).toMatchObject({
      status: "succeeded",
    });
    expect(await call("ext.routines.connect", { account: "account" })).toMatchObject({
      status: "succeeded",
      output: { url: "https://consent.test/?redirect_uri=https://kb.test/calendar/connect" },
    });
    const back = "https://kb.test/calendar/connect?state=state-1&code=granted";
    expect(await call("ext.routines.finish", { redirect: back })).toMatchObject({
      status: "succeeded",
      output: { account: "account" },
    });
    expect(await call("ext.routines.finish", { redirect: back })).toMatchObject({
      status: "failed",
      message: "connect_expired",
    });
    expect(await call("node.get", { id: "account", depth: 0 })).toMatchObject({
      output: {
        node: { props: { [F.status]: [{ t: "ref", v: routineOption("status", "synced") }] } },
      },
    });
    expect((await call("ext.routines.provision", { calendar: "calendar" })).status).toBe("failed");
    expect(await call("sandbox.trust", await digestOf("calendar"))).toMatchObject({
      status: "succeeded",
    });
    const provisioned = await call("ext.routines.provision", { calendar: "calendar" });
    expect(provisioned).toMatchObject({ status: "succeeded" });
    const connected = await call("node.get", { id: "calendar", depth: 0 });
    expect(connected).toMatchObject({
      status: "succeeded",
      output: { node: { props: { [F.calendarId]: [{ t: "str", v: "calendar-1" }] } } },
    });
    expect(provisioned.output).toEqual(await digestOf("calendar"));
    expect(await call("ext.routines.remove", { account: "account" })).toMatchObject({
      status: "succeeded",
      output: { revoked: true },
    });
    expect(revoked).toEqual(["refresh"]);
    expect(secrets.kept.size).toBe(0);

    expect(await call("extension.switch", { name: "routines", on: false })).toMatchObject({
      status: "succeeded",
    });
    expect((await call("ext.routines.status", {})).status).toBe("failed");
  } finally {
    await Effect.runPromise(handle.stop);
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
