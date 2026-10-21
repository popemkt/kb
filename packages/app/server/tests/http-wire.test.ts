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
import type { ServerMessage } from "@kb/contracts";
import { FAKE_TAB_SCREEN } from "@kb/test-kit";
import { startUi, type UiServerHandle } from "../src/index.ts";

let root = "";
let handle: UiServerHandle;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "kb-http-wire-"));
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
async function socket(headers: Record<string, string>, frames: readonly unknown[]) {
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
      if (msg.op === "pong") resolve();
    });
  });
  for (const frame of [...frames, { op: "ping" }]) ws.send(JSON.stringify(frame));
  await done;
  ws.close();
  const person = heard.find((msg) => msg.op === "person")?.person;
  const said = heard.filter((msg) => !["hello", "person", "pong"].includes(msg.op));
  return { opened, person, heard: said };
}

const SCREEN = { op: "screen", tab: "tab.wire", state: FAKE_TAB_SCREEN };
const CHANNEL = { op: "channel", channel: "no.such.channel", data: {} };

describe("a page that holds no token", () => {
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
    const { opened, person, heard } = await socket(headersFrom("program"), [SCREEN, CHANNEL]);
    expect(opened).toBe(true);
    expect(person).toBeNull();
    expect(heard).toEqual([
      expect.objectContaining({ op: "error", id: CHANNEL.channel, code: "forbidden" }),
    ]);
  });

  test("the page's socket is the person's: it publishes its screen and speaks on channels", async () => {
    const page = { ...SCREEN, tab: "tab.page" };
    const { opened, person, heard } = await socket(headersFrom("page"), [page, CHANNEL]);
    expect(opened).toBe(true);
    expect(person).toEqual({ name: expect.any(String) });
    expect(heard).toEqual([
      expect.objectContaining({ op: "error", id: CHANNEL.channel, code: "unknown_channel" }),
    ]);
  });
});
