/**
 * `listen` (DESIGN.md → Action registry → Hosted behind a proxy): a socket
 * exists only with mode 0600, a stale one is replaced, a live one or a file
 * that is no socket is refused, and the socket is gone once its lifetime
 * closes. `kb ui --socket` and `kb mcp --listen unix:…` both bind through it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunFileSystem } from "@effect/platform-bun";
import { Effect, Exit, Scope } from "effect";
import type { ServerListener } from "@kb/contracts";
import { listen } from "../src/index.ts";

let dir = "";
let path = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kb-listen-"));
  path = join(dir, "kb.sock");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Bind a Bun server answering "ok" at `at`, for as long as the returned scope is open. */
async function bind(at: ServerListener) {
  const lifetime = Scope.makeUnsafe("sequential");
  const exit = await Effect.runPromiseExit(
    listen(at, lifetime, (where) => Bun.serve({ ...where, fetch: () => new Response("ok") })).pipe(
      Effect.provide(BunFileSystem.layer),
    ),
  );
  return { exit, close: () => Effect.runPromise(Scope.close(lifetime, Exit.void)) };
}

describe("listen on a socket", () => {
  test("creates it with mode 0600, serves through it, and removes it on close", async () => {
    const { exit, close } = await bind({ kind: "socket", path });
    expect(Exit.isSuccess(exit)).toBe(true);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await (await fetch("http://localhost/", { unix: path })).text()).toBe("ok");
    if (Exit.isSuccess(exit)) await exit.value.stop(true);
    await close();
    expect(await stat(path).catch(() => null)).toBeNull();
  });

  test("replaces a socket nothing listens on", async () => {
    // A killed server leaves its socket file behind, and nothing listens on it.
    const left = Bun.spawn(
      [
        process.execPath,
        "-e",
        "require('node:net').createServer().listen(process.argv[1], () => console.log('up'))",
        path,
      ],
      { stdout: "pipe" },
    );
    await left.stdout.getReader().read();
    left.kill("SIGKILL");
    await left.exited;
    expect((await stat(path)).isSocket()).toBe(true);
    const { exit, close } = await bind({ kind: "socket", path });
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) await exit.value.stop(true);
    await close();
  });

  test("refuses a socket something listens on, and a file that is no socket", async () => {
    const first = await bind({ kind: "socket", path });
    const second = await bind({ kind: "socket", path });
    expect(Exit.isFailure(second.exit)).toBe(true);
    if (Exit.isSuccess(first.exit)) await first.exit.value.stop(true);
    await first.close();

    await writeFile(path, "not a socket");
    const onFile = await bind({ kind: "socket", path });
    expect(Exit.isFailure(onFile.exit)).toBe(true);
    expect(await Bun.file(path).text()).toBe("not a socket");
  });
});
