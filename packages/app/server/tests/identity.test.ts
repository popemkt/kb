/**
 * Who the person behind the page is, as the identity providers a `kb ui`
 * loads say (`src/auth.ts`, DESIGN.md → Surfaces → Who the person is). The
 * page is the request carrying the UI's Origin (`src/guard.ts`); a hosted
 * deployment that trusts its reverse proxy's identity header names it by
 * the login the header carries, and with no provider, or none that answers,
 * it is the account that runs the server. A provider never makes a local
 * program's request, which carries no Origin, the person's.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { IdentityProvider, ServerMessage } from "@kb/contracts";
import { identifyBy } from "../src/auth.ts";
import { identityHeaderIdentity, serverOwner, startUi, type UiServerHandle } from "../src/index.ts";

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
      identity: [identityHeaderIdentity({ header: HEADER, people: [OWNER] })],
    }),
  );
});
afterAll(async () => {
  await Effect.runPromise(handle.stop);
  await rm(root, { recursive: true, force: true });
});

/** The page's Origin, as a browser sends it. */
const pageOf = (server: UiServerHandle) => ({ origin: new URL(server.url).origin });

/** Who the server at `server` tells a `/ws` connection with these handshake headers it is. */
function personOn(server: UiServerHandle, headers: Record<string, string>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${server.url.replace(/^http/, "ws")}/ws`, { headers });
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
  test("the page is the person the header names", async () => {
    expect(await personOn(handle, { ...pageOf(handle), [HEADER]: OWNER })).toEqual({
      name: OWNER,
    });
  });

  test("a page the header names no one known for is the server's owner", async () => {
    const unknown: Record<string, string>[] = [{ [HEADER]: "someone@example.com" }, {}];
    for (const named of unknown) {
      expect(await personOn(handle, { ...pageOf(handle), ...named })).toEqual(serverOwner());
    }
  });

  test("a local program is nobody, whatever the header says", async () => {
    expect(await personOn(handle, { [HEADER]: OWNER })).toBeNull();
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
  const passing: IdentityProvider = { identify: () => null };
  const refusing: IdentityProvider = { identify: () => ({ refused: "no" }) };

  test("with no provider, or when every one passes, a request is nobody's", () => {
    expect(identifyBy([], request({}))).toEqual({ person: null });
    expect(identifyBy([passing, passing], request({}))).toEqual({ person: null });
  });

  test("the first provider that answers decides, a refusal as much as a person", () => {
    expect(identifyBy([passing, person("a"), person("b")], request({}))).toEqual({
      person: { name: "a" },
    });
    expect(identifyBy([passing, refusing, person("a")], request({}))).toEqual({ refused: "no" });
    expect(identifyBy([person("a"), refusing], request({}))).toEqual({ person: { name: "a" } });
  });
});

describe("a kb ui with no identity provider", () => {
  test("runs, and its page is the account that runs it", async () => {
    const bare = await mkdtemp(join(tmpdir(), "kb-no-identity-"));
    const alone = await Effect.runPromise(
      startUi({ root: bare, port: 0, openBrowser: false, identity: [] }),
    );
    try {
      expect(await personOn(alone, pageOf(alone))).toEqual(serverOwner());
      expect(await personOn(alone, {})).toBeNull();
    } finally {
      await Effect.runPromise(alone.stop);
      await rm(bare, { recursive: true, force: true });
    }
  });
});

describe("the identity providers, as extension.list reports them", () => {
  test("are the host's identity point, in the order the server asks them", async () => {
    const res = await fetch(`${handle.url}/api/action`, {
      method: "POST",
      headers: { "content-type": "application/json", ...pageOf(handle) },
      body: JSON.stringify({ id: "extension.list", input: {} }),
    });
    const receipt = (await res.json()) as {
      output: { points: { point: string; source: string; listeners: { owner: string }[] }[] };
    };
    const identity = receipt.output.points.find(({ point }) => point === "identity.providers");
    expect(identity?.source).toBe("host");
    expect(identity?.listeners.map(({ owner }) => owner)).toEqual(["identity-header"]);
  });
});
