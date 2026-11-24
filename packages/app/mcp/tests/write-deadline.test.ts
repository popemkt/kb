/**
 * A write that the caller has given up on never commits afterwards
 * (DESIGN.md → Surfaces → MCP). Over `kb mcp --listen`, a request keeps the
 * end of its deadline to commit and answer, so a write still waiting for
 * the store's lock by then fails, saying so, before the deadline, and does
 * not commit once the lock comes free. On any transport, a call the client
 * cancels is interrupted, and a write it interrupts before it commits does
 * not commit.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createConnection } from "node:net";
import { join } from "node:path";
import { Effect } from "effect";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { acquireFileWriteLockEffect, releaseFileWriteLock } from "@kb/file-write";
import { bunFileSystemLayer, openKb } from "@kb/runtime";
import { createMcpServer } from "../src/mcp.ts";
import { listenMcp } from "../src/http.ts";

/** Whether a JSON-RPC answer is a tool call that failed. */
function failedCall(body: unknown): boolean {
  const result = (body as { result?: { isError?: unknown } }).result;
  return result?.isError === true;
}

let dir = "";
let root = "";

beforeEach(async () => {
  // Canonical, as a socket's directory must be (macOS reaches its tmpdir through /var).
  dir = await realpath(await mkdtemp(join(tmpdir(), "kb-mcp-deadline-")));
  root = join(dir, "root");
  const ctx = await openKb(root);
  await Effect.runPromise(ctx.store.closeEffect);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const nodesFile = () => join(root, ".kb", "nodes.jsonl");

/** Hold the store's write lock, as another writer would, until the returned release. */
async function holdStoreLock(): Promise<() => void> {
  const lock = await Effect.runPromise(acquireFileWriteLockEffect(nodesFile()));
  let held = true;
  return () => {
    if (held) releaseFileWriteLock(lock);
    held = false;
  };
}

/** Whether a node with `text` was ever written to the store. */
async function written(text: string): Promise<boolean> {
  return (await readFile(nodesFile(), "utf8")).includes(text);
}

test("over HTTP, a write held behind the lock past its last chance fails before the deadline and never commits", async () => {
  const socket = join(dir, "mcp.sock");
  const listening = await Effect.runPromise(
    listenMcp(root, `unix:${socket}`, { deadlineMs: 6_000 }).pipe(
      Effect.provide(bunFileSystemLayer),
    ),
  );
  const release = await holdStoreLock();
  try {
    const started = performance.now();
    const answered = await fetch("http://localhost/mcp", {
      unix: socket,
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "node_add", arguments: { text: "held past the deadline" } },
      }),
    });
    // Answered, as a failed call, inside the deadline: not a 503 with an unknown outcome.
    expect(performance.now() - started).toBeLessThan(6_000);
    expect(answered.status).toBe(200);
    expect(failedCall(await answered.json())).toBe(true);

    // The lock comes free after the deadline has passed; the write must not land then.
    await Bun.sleep(Math.max(0, 7_000 - (performance.now() - started)));
    release();
    await Bun.sleep(1_500);
    expect(await written("held past the deadline")).toBe(false);
  } finally {
    release();
    await Effect.runPromise(listening.stop);
  }
}, 30_000);

test("over HTTP, a write's lock wait starts when the write begins, not when a slow body started", async () => {
  const socket = join(dir, "mcp.sock");
  // A 25 s deadline caps writes at 20 s; a body that takes 16 s used to leave a 15 s wait spent.
  const listening = await Effect.runPromise(
    listenMcp(root, `unix:${socket}`, { deadlineMs: 25_000 }).pipe(
      Effect.provide(bunFileSystemLayer),
    ),
  );
  try {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "node_add", arguments: { text: "after a slow upload" } },
    });
    const half = Math.floor(body.length / 2);
    const answer = await new Promise<string>((resolve, reject) => {
      const conn = createConnection({ path: socket });
      let said = "";
      conn.on("data", (chunk) => (said += chunk.toString()));
      conn.on("end", () => resolve(said));
      conn.on("error", reject);
      conn.write(
        [
          "POST /mcp HTTP/1.1",
          "Host: localhost",
          "Content-Type: application/json",
          "Accept: application/json, text/event-stream",
          `Content-Length: ${Buffer.byteLength(body)}`,
          "Connection: close",
          "",
          body.slice(0, half),
        ].join("\r\n"),
      );
      setTimeout(() => conn.write(body.slice(half)), 16_000);
    });
    expect(answer).toStartWith("HTTP/1.1 200");
    expect(failedCall(JSON.parse(answer.slice(answer.indexOf("\r\n\r\n") + 4)))).toBe(false);
    expect(await written("after a slow upload")).toBe(true);
  } finally {
    await Effect.runPromise(listening.stop);
  }
}, 40_000);

test("a cancelled call is interrupted, and its write held behind the lock never commits", async () => {
  const server = await Effect.runPromise(createMcpServer(root));
  const client = new Client({ name: "kb-write-deadline", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  const release = await holdStoreLock();
  try {
    const cancel = new AbortController();
    const call = client.callTool(
      { name: "node_add", arguments: { text: "cancelled while held" } },
      undefined,
      { signal: cancel.signal },
    );
    await Bun.sleep(500);
    cancel.abort("the caller gave up");
    expect(
      await call.then(
        () => "answered",
        () => "cancelled",
      ),
    ).toBe("cancelled");

    release();
    await Bun.sleep(1_500);
    expect(await written("cancelled while held")).toBe(false);
  } finally {
    release();
    await client.close();
    await server.close();
  }
}, 30_000);
