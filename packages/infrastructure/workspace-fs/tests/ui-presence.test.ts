/**
 * Which `kb ui` serves a root: presence says where one was, and only the
 * server's own answer for this root counts (`servingUi`).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { FileSystem } from "effect/FileSystem";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import type { UiListener } from "@kb/contracts";
import { clearUiPresence, readUiPresence, servingUi, writeUiPresence } from "../src/index.ts";

const roots: string[] = [];
const servers: { stop: (force: boolean) => unknown }[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) void server.stop(true);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function scratchRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kb-presence-"));
  await mkdir(join(root, ".kb"));
  roots.push(root);
  return root;
}

/** A TCP listener on this machine at `port`. */
function tcp(port: number): Extract<UiListener, { kind: "tcp" }> {
  return { kind: "tcp", hostname: "127.0.0.1", port };
}

/** Where a socket's proxy serves its page. */
const ORIGIN = "https://kb.example.test";

/** Every way a `kb ui` listens, each once: the presence properties hold for each. */
const KINDS = { tcp: "tcp", socket: "socket" } as const satisfies {
  readonly [K in UiListener["kind"]]: K;
};

/** A socket at `name` in `dir`, which nothing listens on yet. */
function socketIn(dir: string, name: string): Extract<UiListener, { kind: "socket" }> {
  return { kind: "socket", path: join(dir, name), origin: ORIGIN };
}

/** A server listening the way `kind` says, in `dir` for a socket, that says it serves `root`. */
function identityServer(kind: UiListener["kind"], dir: string, root: string): UiListener {
  const fetch = () => Response.json({ root });
  if (kind === "tcp") {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch });
    servers.push(server);
    return tcp(server.port ?? 0);
  }
  const at = socketIn(dir, `ui-${servers.length}.sock`);
  servers.push(Bun.serve({ unix: at.path, fetch }));
  return at;
}

/** A listener of `kind` nothing listens on. */
function goneListener(kind: UiListener["kind"], dir: string): UiListener {
  return kind === "tcp" ? tcp(9) : socketIn(dir, "gone.sock");
}

const run = <A, E>(effect: Effect.Effect<A, E, FileSystem>) =>
  Effect.runPromise(effect.pipe(Effect.provide(BunFileSystem.layer)));

describe("servingUi", () => {
  test("a root with no presence is served by nothing", async () => {
    expect(await run(servingUi(await scratchRoot()))).toBeNull();
  });

  for (const kind of Object.values(KINDS)) {
    test(`presence whose ${kind} server answers for this root names that server`, async () => {
      const root = await scratchRoot();
      const at = identityServer(kind, root, await realpath(root));
      await run(writeUiPresence(root, at));
      expect(await run(servingUi(root))).toEqual(at);
    });

    test(`presence whose ${kind} server answers for another root, or nothing at all, is not trusted`, async () => {
      const root = await scratchRoot();
      await run(writeUiPresence(root, identityServer(kind, root, "/elsewhere")));
      expect(await run(servingUi(root))).toBeNull();
      const gone = await scratchRoot();
      await run(writeUiPresence(gone, goneListener(kind, gone)));
      expect(await run(servingUi(gone))).toBeNull();
    });
  }

  test("presence naming anything but a kb ui on this machine is not read, nor asked", async () => {
    const root = await scratchRoot();
    let asked = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => {
        asked++;
        return Response.json({ root });
      },
    });
    servers.push(server);
    const port = server.port ?? 0;
    const forgeries: unknown[] = [
      { kind: "tcp", hostname: "127.0.0.1/elsewhere", port },
      { kind: "tcp", hostname: "user:pw@127.0.0.1", port },
      { kind: "tcp", hostname: "127.0.0.1", port: port + 0.5 },
      { kind: "tcp", hostname: "example.com", port: 80 },
      { kind: "tcp", hostname: "10.0.0.1", port: 4321 },
      { kind: "tcp", hostname: "0.0.0.0", port },
      { kind: "https", hostname: "127.0.0.1", port },
      { kind: "socket", path: "relative/kb.sock", origin: ORIGIN },
      { kind: "socket", path: join(root, "kb.sock"), origin: `${ORIGIN}/elsewhere` },
      { kind: "socket", path: join(root, "kb.sock"), origin: "javascript:alert(1)" },
      { kind: "socket", path: join(root, "kb.sock") },
      // What a server wrote before presence named its listener.
      `http://127.0.0.1:${port}`,
    ];
    for (const at of forgeries) {
      const forged = { at, url: at, pid: process.pid, root: await realpath(root) };
      await writeFile(join(root, ".kb", "ui.json"), JSON.stringify(forged));
      expect(await run(readUiPresence(root))).toBeNull();
      expect(await run(servingUi(root))).toBeNull();
    }
    expect(asked).toBe(0);
  });

  test("a server writes presence only for a listener on this machine", async () => {
    const root = await scratchRoot();
    const elsewhere: UiListener[] = [
      { kind: "tcp", hostname: "0.0.0.0", port: 4321 },
      { kind: "socket", path: "kb.sock", origin: ORIGIN },
    ];
    for (const at of elsewhere) {
      const refused = await run(Effect.flip(writeUiPresence(root, at)));
      expect(refused.code).toBe("invalid_input");
      expect(await run(readUiPresence(root))).toBeNull();
    }
  });
});

describe("clearUiPresence", () => {
  test("removes the file this process's server wrote", async () => {
    const root = await scratchRoot();
    for (const at of [tcp(4321), socketIn(root, "kb.sock")]) {
      await run(writeUiPresence(root, at));
      await run(clearUiPresence(root, at));
      expect(await run(readUiPresence(root))).toBeNull();
    }
  });

  test("leaves a file another server wrote, at another listener or from another process at the same one", async () => {
    const root = await scratchRoot();
    await run(writeUiPresence(root, tcp(4322)));
    await run(clearUiPresence(root, tcp(4321)));
    await run(clearUiPresence(root, socketIn(root, "kb.sock")));
    expect(await run(readUiPresence(root))).not.toBeNull();
    const reused = { at: tcp(4321), pid: process.pid + 1, root: await realpath(root) };
    await writeFile(join(root, ".kb", "ui.json"), JSON.stringify(reused));
    await run(clearUiPresence(root, tcp(4321)));
    expect(await run(readUiPresence(root))).toEqual(reused);
  });
});
