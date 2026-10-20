/**
 * A hosted `kb ui` that trusts its reverse proxy's identity header
 * (`src/auth.ts`, DESIGN.md → Surfaces → Who the person is): a request
 * whose header names the person is theirs, on the page's wire, with no page
 * token; one naming anyone else, or carrying none, is nobody's. The page
 * token still authenticates beside it, and a stale one is refused whatever
 * the header says.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { PAGE_TOKEN_HEADER, type ServerMessage } from "@kb/contracts";
import { SYSTEM_IDS } from "@kb/model";
import {
  anyAuthenticator,
  identityHeaderAuthenticator,
  pageTokenAuthenticator,
} from "../src/auth.ts";
import { startUi, type UiServerHandle } from "../src/index.ts";

const HEADER = "Tailscale-User-Login";
const OWNER = "owner@example.com";

let root = "";
let handle: UiServerHandle;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "kb-identity-header-"));
  handle = await Effect.runPromise(
    startUi({
      root,
      port: 0,
      openBrowser: false,
      identityHeader: { header: HEADER, people: [OWNER] },
    }),
  );
});
afterAll(async () => {
  await Effect.runPromise(handle.stop);
  await rm(root, { recursive: true, force: true });
});

/** A write that always needs a person behind it, approved as the page approves one. */
const approvedPolicy = {
  id: "node.add",
  input: { text: "allow everything", tags: [SYSTEM_IDS.approvalPolicyTag] },
  actor: "agent",
  approved: true,
};

async function post(headers: Record<string, string>) {
  const res = await fetch(`${handle.url}/api/action`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(approvedPolicy),
  });
  return { status: res.status, body: (await res.json()) as { status: string; code?: string } };
}

/** Who the server tells a `/ws` connection with these handshake headers it is. */
function personOn(headers: Record<string, string>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${handle.url.replace(/^http/, "ws")}/ws`, { headers });
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data)) as ServerMessage;
      if (msg.op !== "person") return;
      ws.close();
      resolve(msg.person);
    });
    ws.addEventListener("error", () => reject(new Error("refused")));
  });
}

describe("a kb ui that trusts its proxy's identity header", () => {
  test("a request the header names the person for is theirs: it may approve", async () => {
    expect((await post({ [HEADER]: OWNER })).body).toMatchObject({ status: "succeeded" });
    expect(await personOn({ [HEADER]: OWNER })).toEqual({ name: OWNER });
  });

  test("a request naming anyone else, or no one, is nobody's", async () => {
    const nobodys: Record<string, string>[] = [{ [HEADER]: "someone@example.com" }, {}];
    for (const headers of nobodys) {
      const { status, body } = await post(headers);
      expect(status).toBe(403);
      expect(body).toMatchObject({ code: "forbidden" });
      expect(await personOn(headers)).toBeNull();
    }
  });

  test("the page token authenticates beside it, and a stale one is refused whatever the header says", async () => {
    expect((await post({ [PAGE_TOKEN_HEADER]: handle.pageToken })).body).toMatchObject({
      status: "succeeded",
    });
    const stale = { [PAGE_TOKEN_HEADER]: "0".repeat(handle.pageToken.length), [HEADER]: OWNER };
    expect((await post(stale)).status).toBe(403);
  });
});

/** A request to the API carrying `headers`. */
function request(headers: Record<string, string>): Request {
  return new Request("http://127.0.0.1/api/graph", { headers });
}

describe("authenticators", () => {
  const header = identityHeaderAuthenticator({ header: HEADER, people: [OWNER, "other@x"] });

  test("the identity header names whichever of its people the request names, and no one else", () => {
    expect(header.identify(request({ [HEADER]: "other@x" }))).toEqual({
      person: { name: "other@x" },
    });
    expect(header.identify(request({ [HEADER]: "stranger@x" }))).toEqual({ person: null });
    expect(header.identify(request({}))).toEqual({ person: null });
  });

  test("any of several: a refusal wins, then the first that finds the person", () => {
    const token = pageTokenAuthenticator("t".repeat(64), { name: "local" });
    const both = anyAuthenticator([token, header]);
    expect(both.identify(request({ [HEADER]: OWNER }))).toEqual({ person: { name: OWNER } });
    expect(both.identify(request({ [PAGE_TOKEN_HEADER]: "t".repeat(64) }))).toEqual({
      person: { name: "local" },
    });
    expect(both.identify(request({}))).toEqual({ person: null });
    expect(
      both.identify(request({ [PAGE_TOKEN_HEADER]: "x".repeat(64), [HEADER]: OWNER })),
    ).toHaveProperty("refused");
  });
});
