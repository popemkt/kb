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

/** Real invoke, graph tail and family lifecycle; Calendar stays in memory. */
test("routines is optional, outline fields preview through real actions, and unload stops its worker", async () => {
  const root = await mkdtemp(join(tmpdir(), "kb-routines-host-"));
  const fake = makeFakeCalendar();
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
            connect: (_binding, trusted) =>
              trusted.pipe(
                Effect.flatMap((allowed) =>
                  allowed
                    ? Effect.succeed({ url: "https://consent.test", finish: () => Effect.void })
                    : Effect.fail(new SyncError({ status: 403, code: "untrusted" })),
                ),
              ),
          }),
        },
      ],
    }).pipe(Effect.provide(bunFileSystemLayer)),
  );
  const origin = new URL(handle.url).origin;
  const call = async (id: string, input: unknown) => {
    const response = await fetch(origin + "/api/action", {
      method: "POST",
      headers: { origin, "Content-Type": "application/json" },
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
    expect((await call("ext.routines.connect", { calendar: "calendar" })).status).toBe("failed");
    const binding = Schema.decodeUnknownSync(Schema.Struct({ digest: Schema.String }))(
      (await call("ext.routines.binding", { calendar: "calendar" })).output,
    );
    expect(await call("sandbox.trust", binding)).toMatchObject({ status: "succeeded" });
    expect(await call("ext.routines.connect", { calendar: "calendar" })).toMatchObject({
      status: "succeeded",
      output: { url: "https://consent.test" },
    });
    expect((await call("ext.routines.finish", { calendar: "calendar" })).status).toBe("succeeded");
    const connected = await call("node.get", { id: "calendar", depth: 0 });
    expect(connected).toMatchObject({
      status: "succeeded",
      output: { node: { props: { [F.calendarId]: [{ t: "str", v: "calendar-1" }] } } },
    });

    expect(await call("extension.switch", { name: "routines", on: false })).toMatchObject({
      status: "succeeded",
    });
    expect((await call("ext.routines.status", {})).status).toBe("failed");
  } finally {
    await Effect.runPromise(handle.stop);
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
