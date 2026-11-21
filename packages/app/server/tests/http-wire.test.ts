/**
 * Who makes a call to the API (`src/guard.ts`, DESIGN.md → Surfaces → Who
 * the person is): a request carrying the UI's own Origin is the page's, the
 * person's; one carrying none is a local program's, an agent's; one from
 * another site's page is refused. No page holds a token, so a page opened
 * however it is opened works the same, and a call is never refused for who
 * it says makes it: the surface says that.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { SYSTEM_IDS } from "@kb/model";
import { CAPTURE_PAIR, CAPTURE_PAIR_CODE, type ServerMessage } from "@kb/contracts";
import { invoke, openKb } from "@kb/runtime";
import {
  FAKE_TAB_SCREEN,
  extensionModule,
  trustExtension,
  writeTrustedExtension,
} from "@kb/test-kit";
import { startUi, type UiServerHandle } from "../src/index.ts";

let root = "";
let handle: UiServerHandle;

const RELAY_FIXTURE = extensionModule("relay-fixture", {
  prelude: "const passthrough = { parse: (value) => value };",
  actions: `[
    {
      id: "read",
      title: "Program read",
      description: "A read available to native programs.",
      mode: { kind: "read" },
      callers: ["program"],
      inputSchema: passthrough,
      outputSchema: passthrough,
      handler: async () => ({ ran: true }),
    },
    {
      id: "write",
      title: "Approved write",
      description: "A write that requires approval.",
      mode: { kind: "write", approval: "required" },
      inputSchema: passthrough,
      outputSchema: passthrough,
      handler: async () => ({ ran: true }),
    },
  ]`,
});

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "kb-http-wire-"));
  await writeTrustedExtension(root, "relay-fixture.ts", RELAY_FIXTURE);
  await writeTrustedExtension(
    root,
    "pairing-policy.ts",
    `
import { Effect, defineExtension, definePlugin, guardAction } from "kb-ext-sdk";
export const declaration = defineExtension({ name: "pairing-policy", label: "Pairing policy" });
export default definePlugin({
  name: declaration.name,
  apply: (plugin) => guardAction(plugin, ${JSON.stringify(CAPTURE_PAIR)}, {
    before: ({ invocation }) => Effect.succeed(
      invocation.session === undefined && invocation.via === undefined
        ? { decision: "ask", rule: "pairing-approval", message: "approve pairing" }
        : { decision: "deny", rule: "pairing-metadata", message: "pairing received request metadata" },
    ),
  }, "pairing"),
});
`,
  );
  handle = await Effect.runPromise(startUi({ root, port: 0, openBrowser: false }));
});
afterAll(async () => {
  await Effect.runPromise(handle.stop);
  await rm(root, { recursive: true, force: true });
});

/** Who sends a request: what it carries beside its body. */
type From = "page" | "program" | "elsewhere";

function headersFrom(from: From): Record<string, string> {
  const carried: Record<From, Record<string, string>> = {
    page: { origin: new URL(handle.url).origin },
    program: {},
    elsewhere: { origin: "https://evil.example" },
  };
  return carried[from];
}

/** A call to the server's API from `from`. */
async function post(body: unknown, from: From) {
  const res = await fetch(`${handle.url}/api/action`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headersFrom(from) },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json()) as { status: string; code?: string; output?: unknown },
  };
}

/** A `/ws` connection carrying `headers`: the frames it is answered, or why it did not open. */
async function socket(
  headers: Record<string, string>,
  frames: readonly unknown[],
  channelReply?: string,
) {
  const ws = new WebSocket(`${handle.url.replace(/^http/, "ws")}/ws`, { headers });
  const heard: ServerMessage[] = [];
  const opened = await new Promise<boolean>((resolve) => {
    ws.addEventListener("open", () => resolve(true));
    ws.addEventListener("error", () => resolve(false));
  });
  if (!opened) return { opened, heard };
  const done = new Promise<void>((resolve) => {
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data)) as ServerMessage;
      heard.push(msg);
      // A heartbeat can answer while the channel is still acquiring its registry.
      const pong = heard.some((frame) => frame.op === "pong");
      const channelAnswered =
        channelReply === undefined ||
        heard.some((frame) => frame.op === "error" && frame.id === channelReply);
      if (pong && channelAnswered) resolve();
    });
  });
  for (const frame of [...frames, { op: "ping" }]) ws.send(JSON.stringify(frame));
  await done;
  ws.close();
  const person = heard.find((msg) => msg.op === "person")?.person;
  const said = heard.filter(
    (msg) => !["hello", "person", "extension-watch", "pong"].includes(msg.op),
  );
  return { opened, person, heard: said };
}

const SCREEN = { op: "screen", tab: "tab.wire", state: FAKE_TAB_SCREEN };
const CHANNEL = { op: "channel", channel: "no.such.channel", data: {} };

describe("a page that holds no token", () => {
  test("a program relay stays within page admission and cannot assert approval", async () => {
    await trustExtension(root, "relay-fixture.ts");
    const read = { id: "ext.relay-fixture.read", input: {} };
    expect((await post(read, "program")).body).toMatchObject({ status: "succeeded" });
    expect((await post(read, "page")).body).toMatchObject({ status: "failed", code: "forbidden" });
    expect((await post({ ...read, caller: "program" }, "page")).body).toMatchObject({
      status: "failed",
      code: "forbidden",
    });

    const write = { id: "ext.relay-fixture.write", input: {} };
    expect((await post(write, "page")).body).toMatchObject({ status: "succeeded" });
    expect(
      (await post({ ...write, caller: "program", approved: true }, "page")).body,
    ).toMatchObject({
      status: "failed",
      code: "approval_required",
    });
  });

  test("pairing on the page wire uses the action's input-only envelope", async () => {
    await trustExtension(root, "pairing-policy.ts");
    const ctx = await openKb(root);
    const issued = await invoke(ctx, { id: CAPTURE_PAIR_CODE, input: {} });
    if (issued.status !== "succeeded") throw new Error(JSON.stringify(issued));
    const { code } = issued.output as { code: string };
    const pairing = await post(
      {
        id: CAPTURE_PAIR,
        input: { code, deviceName: "Phone" },
        approved: true,
        session: "tab.policy",
        via: "pairing-test",
      },
      "page",
    );
    expect(pairing.status).toBe(200);
    expect(pairing.body.code).toBe("approval_required");
    expect(pairing.body).toHaveProperty("message", "approve pairing");
  });

  test("edits: a node it adds and renames is written", async () => {
    const added = await post({ id: "node.add", input: { id: "n.page", text: "mine" } }, "page");
    expect(added.body).toMatchObject({ status: "succeeded" });
    const renamed = await post(
      { id: "node.update", input: { id: "n.page", text: "renamed" } },
      "page",
    );
    expect(renamed.body).toMatchObject({ status: "succeeded" });
  });

  test("switches a view: the node's view option is written", async () => {
    await post({ id: "node.add", input: { id: "n.viewed", text: "viewed" } }, "page");
    const switched = await post(
      {
        id: "node.update",
        input: {
          id: "n.viewed",
          setProps: [
            { field: SYSTEM_IDS.viewField, value: { t: "ref", v: "sys.view.outline.table" } },
          ],
        },
      },
      "page",
    );
    expect(switched.body).toMatchObject({ status: "succeeded" });
  });

  test("is never refused for who a call says makes it", async () => {
    for (const actor of ["human", "agent", "cli", "script"]) {
      for (const from of ["page", "program"] as const) {
        const { status, body } = await post(
          { id: "node.add", input: { text: `${actor} from ${from}` }, actor },
          from,
        );
        expect({ actor, from, status, body: body.status }).toEqual({
          actor,
          from,
          status: 200,
          body: "succeeded",
        });
      }
    }
  });
});

describe("who reaches the API", () => {
  test("another site's page is refused, on every route", async () => {
    const { status, body } = await post({ id: "node.add", input: { text: "x" } }, "elsewhere");
    expect(status).toBe(403);
    expect(body).toMatchObject({ status: "failed", code: "forbidden" });
    const read = await fetch(`${handle.url}/api/graph`, { headers: headersFrom("elsewhere") });
    expect(read.status).toBe(403);
    expect((await socket(headersFrom("elsewhere"), [])).opened).toBe(false);
  });
});

describe("who speaks on /ws", () => {
  test("a local program's socket is nobody's: it publishes its screen, and may not speak on a channel", async () => {
    const { opened, person, heard } = await socket(
      headersFrom("program"),
      [SCREEN, CHANNEL],
      CHANNEL.channel,
    );
    expect(opened).toBe(true);
    expect(person).toBeNull();
    expect(heard).toEqual([
      expect.objectContaining({ op: "error", id: CHANNEL.channel, code: "forbidden" }),
    ]);
  });

  test("the page's socket is the person's: it publishes its screen and speaks on channels", async () => {
    const page = { ...SCREEN, tab: "tab.page" };
    const { opened, person, heard } = await socket(
      headersFrom("page"),
      [page, CHANNEL],
      CHANNEL.channel,
    );
    expect(opened).toBe(true);
    expect(person).toEqual({ name: expect.any(String) });
    expect(heard).toEqual([
      expect.objectContaining({ op: "error", id: CHANNEL.channel, code: "unknown_channel" }),
    ]);
  });
});
