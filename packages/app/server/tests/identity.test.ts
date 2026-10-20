/**
 * Who the person is, as the identity providers a `kb ui` loads say: a hosted
 * one that trusts its reverse proxy's identity header
 * (`src/auth.ts`, DESIGN.md → Surfaces → Who the person is): a request
 * whose header names the person is theirs, on the page's wire, with no page
 * token; one naming anyone else, or carrying none, is nobody's. The page
 * token still authenticates beside it, and a stale one is refused whatever
 * the header says. With no provider at all the server still runs, and
 * every connection is nobody's.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { PAGE_TOKEN_HEADER, type IdentityProvider, type ServerMessage } from "@kb/contracts";
import { SYSTEM_IDS } from "@kb/model";
import { identifyBy } from "../src/auth.ts";
import {
  identityHeaderIdentity,
  pageTokenIdentity,
  startUi,
  type UiServerHandle,
} from "../src/index.ts";

const HEADER = "Tailscale-User-Login";
const OWNER = "owner@example.com";
const TOKEN = "a".repeat(64);

let root = "";
let handle: UiServerHandle;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "kb-identity-header-"));
  handle = await Effect.runPromise(
    startUi({
      root,
      port: 0,
      openBrowser: false,
      identity: [
        pageTokenIdentity(TOKEN),
        identityHeaderIdentity({ header: HEADER, people: [OWNER] }),
      ],
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
    expect((await post({ [PAGE_TOKEN_HEADER]: TOKEN })).body).toMatchObject({
      status: "succeeded",
    });
    const stale = { [PAGE_TOKEN_HEADER]: "0".repeat(TOKEN.length), [HEADER]: OWNER };
    expect((await post(stale)).status).toBe(403);
  });
});

/** A request to the API carrying `headers`. */
function request(headers: Record<string, string>): Request {
  return new Request("http://127.0.0.1/api/graph", { headers });
}

/** A provider that finds every request is `name`'s. */
function person(name: string): IdentityProvider {
  return { identify: () => ({ person: { name } }) };
}

describe("identifyBy", () => {
  const nobody = { identify: () => ({ person: null }) };
  const refusing = { identify: () => ({ refused: "no" }) };

  test("with no provider, every request is nobody's", () => {
    expect(identifyBy([], request({}))).toEqual({ person: null });
  });

  test("a refusal wins, then the first provider that finds the person", () => {
    expect(identifyBy([nobody, person("a"), person("b")], request({}))).toEqual({
      person: { name: "a" },
    });
    expect(identifyBy([person("a"), refusing], request({}))).toEqual({ refused: "no" });
    expect(identifyBy([nobody, nobody], request({}))).toEqual({ person: null });
  });
});

describe("a kb ui with no identity provider", () => {
  test("runs, opens its bare URL, and takes every connection as nobody's", async () => {
    const bare = await mkdtemp(join(tmpdir(), "kb-no-identity-"));
    const alone = await Effect.runPromise(
      startUi({ root: bare, port: 0, openBrowser: false, identity: [] }),
    );
    try {
      expect(alone.pageToken).toBeNull();
      expect(alone.page).toBe(alone.url);
      const res = await fetch(`${alone.url}/api/action`, {
        method: "POST",
        headers: { "content-type": "application/json", [PAGE_TOKEN_HEADER]: TOKEN },
        body: JSON.stringify(approvedPolicy),
      });
      // No provider vouches for anyone, and none refuses a token it never minted.
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "forbidden" });
    } finally {
      await Effect.runPromise(alone.stop);
      await rm(bare, { recursive: true, force: true });
    }
  });
});
