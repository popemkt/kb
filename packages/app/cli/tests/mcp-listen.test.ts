/**
 * `kb mcp --listen` (DESIGN.md → Surfaces → MCP), run as the real CLI: over
 * Streamable HTTP it lists the tools and resources stdio lists on the same
 * store, a read, a write and a resource read answer, and the write, made with
 * the `KB_VIA` the process was started with, is what a stdio reader then
 * sees. Its socket is mode 0600; any path but `/mcp` is not found; a TCP
 * listener answers only to its own `Host`; a browser's `Origin` other than
 * the listener's own is refused; an address another machine could reach is
 * refused. A request is bounded: one JSON-RPC message, a body that fits the
 * largest asset upload and no more, a few at once, and a connection kept
 * through a write's wait for the store's lock.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Effect } from "effect";
import { acquireFileWriteLockEffect, releaseFileWriteLock } from "@kb/file-write";
import { ASSET_BYTES_INPUT_MAX, ASSET_MAX_BYTES } from "@kb/operations";
import { governanceMode } from "@kb/runtime";
import { KB_SOURCE_BIN } from "@kb/test-kit";

const VIA = "mcp-remote";
const TextResultSchema = z.object({
  isError: z.boolean().optional(),
  content: z.array(z.object({ type: z.literal("text"), text: z.string() })).min(1),
});
const ChangesSchema = z.object({ changes: z.array(z.object({ via: z.string().optional() })) });

let dir = "";
let root = "";
let socket = "";
const children: Bun.Subprocess[] = [];
const clients: Client[] = [];

/** This run's environment (its isolated home), with `extra` over it. */
function envWith(extra: Record<string, string> = {}): Record<string, string> {
  return Object.fromEntries(
    Object.entries({ ...process.env, ...extra }).flatMap(([k, v]) =>
      v === undefined ? [] : [[k, v]],
    ),
  );
}

/** `kb mcp --listen <address>` over the root, until it says where it listens. */
async function listening(address: string): Promise<{ child: Bun.Subprocess; said: string }> {
  const child = Bun.spawn(
    [KB_SOURCE_BIN, "--governance", governanceMode(), "--root", root, "mcp", "--listen", address],
    { stdin: "ignore", stdout: "ignore", stderr: "pipe", env: envWith({ KB_VIA: VIA }) },
  );
  children.push(child);
  const reader = child.stderr.getReader();
  let said = "";
  while (!said.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`kb mcp --listen ${address} exited: ${said}`);
    said += new TextDecoder().decode(value);
  }
  reader.releaseLock();
  return { child, said: said.trim() };
}

async function connected(transport: StdioClientTransport | StreamableHTTPClientTransport) {
  const client = new Client({ name: "kb-mcp-listen", version: "0.0.0" });
  await client.connect(transport);
  clients.push(client);
  return client;
}

/** A client over the socket: every request goes to `path`, naming `localhost` as a proxy would. */
function overSocket(path: string) {
  return connected(
    new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
      fetch: (url, init) => fetch(url, { ...init, unix: path }),
    }),
  );
}

function overStdio() {
  return connected(
    new StdioClientTransport({
      command: KB_SOURCE_BIN,
      args: ["--governance", governanceMode(), "--root", root, "mcp"],
      env: envWith(),
      stderr: "ignore",
    }),
  );
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = TextResultSchema.parse(await client.callTool({ name, arguments: args }));
  expect(result.isError ?? false).toBe(false);
  return JSON.parse(result.content[0]?.text ?? "null") as unknown;
}

/** One raw JSON-RPC POST over the socket, as a client that skips initialize sends it. */
function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch("http://localhost/mcp", {
    unix: socket,
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** A `tools/call` request, as a JSON-RPC message. */
function toolCall(id: number, name: string, args: Record<string, unknown>) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

const RpcResultSchema = z.object({ result: TextResultSchema });
const RpcErrorSchema = z.object({ error: z.object({ code: z.number(), message: z.string() }) });

beforeAll(async () => {
  // Canonical, as a socket's directory must be (macOS reaches its tmpdir through /var).
  dir = await realpath(await mkdtemp(join(tmpdir(), "kb-mcp-listen-")));
  root = join(dir, "root");
  socket = join(dir, "mcp.sock");
  // The root's first open writes its seed, before either server reads it.
  const init = Bun.spawnSync(
    [KB_SOURCE_BIN, "--governance", governanceMode(), "--root", root, "add", "seed"],
    { env: envWith() },
  );
  expect(init.exitCode).toBe(0);
  await listening(`unix:${socket}`);
});

afterAll(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const child of children.splice(0)) {
    child.kill();
    await child.exited;
  }
  await rm(dir, { recursive: true, force: true });
});

describe("kb mcp --listen on a socket", () => {
  test("is created with mode 0600", async () => {
    const info = await stat(socket);
    expect(info.isSocket()).toBe(true);
    expect(info.mode & 0o777).toBe(0o600);
  });

  test("lists the tools and resources stdio lists on the same store", async () => {
    const [http, stdio] = await Promise.all([overSocket(socket), overStdio()]);
    const [httpTools, stdioTools] = await Promise.all([http.listTools(), stdio.listTools()]);
    expect(httpTools.tools.length).toBeGreaterThan(0);
    expect(httpTools).toEqual(stdioTools);
    const [httpResources, stdioResources] = await Promise.all([
      http.listResources(),
      stdio.listResources(),
    ]);
    expect(httpResources.resources.length).toBeGreaterThan(0);
    expect(httpResources).toEqual(stdioResources);
  });

  test("answers a read, a write and a resource read; stdio then reads the write, labelled with KB_VIA", async () => {
    const http = await overSocket(socket);
    const added = z
      .object({ id: z.string() })
      .parse(await call(http, "node_add", { text: "written over http" }));
    expect(await call(http, "node_get", { id: added.id })).toMatchObject({
      node: { id: added.id, text: "written over http" },
    });
    const [resource] = (await http.listResources()).resources;
    if (resource === undefined) throw new Error("no resource listed");
    const read = await http.readResource({ uri: resource.uri });
    expect(read.contents[0]).toMatchObject({ uri: resource.uri });

    const stdio = await overStdio();
    expect(await call(stdio, "node_get", { id: added.id })).toMatchObject({
      node: { id: added.id, text: "written over http" },
    });
    const { changes } = ChangesSchema.parse(
      await call(stdio, "graph_changes", { since: 0, viaPrefix: VIA }),
    );
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.every((change) => change.via === VIA)).toBe(true);
  });

  test("finds nothing but /mcp, and takes only POST there", async () => {
    for (const route of ["/", "/mcp/", "/other"]) {
      expect((await fetch(`http://localhost${route}`, { unix: socket })).status).toBe(404);
    }
    const get = await fetch("http://localhost/mcp", { unix: socket });
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
  });
});

describe("kb mcp --listen bounds each request", () => {
  test("refuses a browser page's Origin before reading the body, and takes a request without one", async () => {
    const list = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    expect((await post(list, { origin: "https://attacker.example" })).status).toBe(403);
    expect((await post(list, { origin: "http://localhost" })).status).toBe(403);
    expect((await post(list)).status).toBe(200);
  });

  test("takes one JSON-RPC message per request: a batch or a body that is not JSON is a JSON-RPC error", async () => {
    const list = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    const batch = await post([list, { ...list, id: 2 }]);
    expect(batch.status).toBe(400);
    expect(RpcErrorSchema.parse(await batch.json()).error.code).toBe(-32600);
    const garbled = await post("{ not json");
    expect(garbled.status).toBe(400);
    expect(RpcErrorSchema.parse(await garbled.json()).error.code).toBe(-32700);
  });

  test("takes an upload of the largest asset, and refuses a body larger than one", async () => {
    const largest = Buffer.alloc(ASSET_MAX_BYTES, 7).toString("base64");
    const uploaded = await post(toolCall(1, "asset_upload", { bytes: largest, ext: "png" }));
    expect(uploaded.status).toBe(200);
    expect(RpcResultSchema.parse(await uploaded.json()).result.isError ?? false).toBe(false);

    const tooLarge = await post(
      toolCall(2, "asset_upload", { bytes: "A".repeat(ASSET_BYTES_INPUT_MAX + 1024 * 1024) }),
    );
    expect(tooLarge.status).toBe(413);
  });

  test("answers a few requests at once, refuses one more with 503, and keeps each connection through the store's lock wait", async () => {
    // Every write waits on the store's lock, held here past Bun's default 10 s idle timeout.
    const lock = await Effect.runPromise(
      acquireFileWriteLockEffect(join(root, ".kb", "nodes.jsonl")),
    );
    let released = false;
    const release = () => {
      if (!released) releaseFileWriteLock(lock);
      released = true;
    };
    try {
      const writes = Array.from({ length: 8 }, (_, i) =>
        post(toolCall(i + 1, "node_add", { text: `held write ${i}` })),
      );
      await Bun.sleep(1_000);
      const extra = await post(toolCall(99, "node_add", { text: "one too many" }));
      expect(extra.status).toBe(503);
      expect(RpcErrorSchema.parse(await extra.json()).error.code).toBe(-32000);

      await Bun.sleep(10_500);
      release();
      for (const answered of await Promise.all(writes)) {
        expect(answered.status).toBe(200);
        expect(RpcResultSchema.parse(await answered.json()).result.isError ?? false).toBe(false);
      }
    } finally {
      release();
    }
  }, 40_000);
});

describe("kb mcp --listen that cannot start", () => {
  test("exits at once, saying why, when it cannot bind its socket", async () => {
    const child = Bun.spawn(
      [
        KB_SOURCE_BIN,
        "--root",
        root,
        "mcp",
        "--listen",
        `unix:${join(dir, "missing", "mcp.sock")}`,
      ],
      { stdin: "ignore", stdout: "ignore", stderr: "pipe", env: envWith() },
    );
    const exited = await Promise.race([child.exited, Bun.sleep(15_000).then(() => "running")]);
    if (exited === "running") child.kill();
    expect(exited).toBe(1);
    expect(await new Response(child.stderr).text()).toContain("does not exist");
  });
});

describe("kb mcp --listen on a TCP port", () => {
  test("serves on loopback and answers only to its own Host", async () => {
    const { said } = await listening("127.0.0.1:0");
    const url = /http:\/\/127\.0\.0\.1:\d+\/mcp/.exec(said)?.[0];
    if (url === undefined) throw new Error(`no address in: ${said}`);
    const client = await connected(new StreamableHTTPClientTransport(new URL(url)));
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
    const rebound = await fetch(url, {
      method: "POST",
      headers: {
        host: "attacker.example",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(rebound.status).toBe(403);
    const list = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const fromOrigin = (origin: string) =>
      fetch(url, {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: list,
      });
    expect((await fromOrigin(new URL(url).origin)).status).toBe(200);
    expect((await fromOrigin("http://attacker.example")).status).toBe(403);
  });

  test("refuses an address another machine could reach, and starts nothing", async () => {
    for (const address of ["0.0.0.0:0", "192.168.1.5:0", "[::]:0", "localhost:0"]) {
      const child = Bun.spawn([KB_SOURCE_BIN, "--root", root, "mcp", "--listen", address], {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "pipe",
        env: envWith(),
      });
      const [said, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
      expect({ address, code }).toEqual({ address, code: 1 });
      expect(said).toContain("listens only where this machine alone reaches it");
    }
  });
});
