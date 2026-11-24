/**
 * `listen` (DESIGN.md → Action registry → Hosted behind a proxy): a socket
 * is made only where no other account can change its path (a canonical
 * directory, every directory up to / checked), exists only with
 * mode 0600, replaces a stale one atomically under a lock so concurrent
 * starts never both win, refuses a live one, a link or a file that is no
 * socket, and is removed on close only while the path still holds the
 * socket this process made. `kb ui --socket` and `kb mcp --listen unix:…`
 * both bind through it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cause, Effect, Exit, Scope } from "effect";
import type { ServerListener } from "@kb/contracts";
import { listen } from "../src/index.ts";

let dir = "";
let path = "";

beforeEach(async () => {
  // Canonical, as a socket's directory must be (macOS reaches its tmpdir through /var).
  dir = await realpath(await mkdtemp(join(tmpdir(), "kb-listen-")));
  path = join(dir, "kb.sock");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Bind a Bun server answering `says` at `at`, for as long as the returned scope is open. */
async function bind(at: ServerListener, says = "ok") {
  const lifetime = Scope.makeUnsafe("sequential");
  const exit = await Effect.runPromiseExit(
    listen(at, lifetime, (where) => Bun.serve({ ...where, fetch: () => new Response(says) })),
  );
  const stop = async () => {
    if (Exit.isSuccess(exit)) await exit.value.stop(true);
    await Effect.runPromise(Scope.close(lifetime, Exit.void));
  };
  return { exit, stop };
}

/** Whether binding a socket at `at` is refused. */
async function refused(at: string): Promise<boolean> {
  const { exit, stop } = await bind({ kind: "socket", path: at });
  await stop();
  return Exit.isFailure(exit);
}

/** What the socket at `at` answers. */
async function answer(at: string): Promise<string> {
  return (await fetch("http://localhost/", { unix: at })).text();
}

/** A socket file nothing listens on, as a killed server leaves it. */
async function staleSocketAt(at: string): Promise<void> {
  const left = Bun.spawn(
    [
      process.execPath,
      "-e",
      "require('node:net').createServer().listen(process.argv[1], () => console.log('up'))",
      at,
    ],
    { stdout: "pipe" },
  );
  await left.stdout.getReader().read();
  left.kill("SIGKILL");
  await left.exited;
  expect((await stat(at)).isSocket()).toBe(true);
}

describe("listen on a socket", () => {
  test("creates it with mode 0600, serves through it, and removes it on close", async () => {
    const { exit, stop } = await bind({ kind: "socket", path });
    expect(Exit.isSuccess(exit)).toBe(true);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await answer(path)).toBe("ok");
    await stop();
    expect(await readdir(dir)).toEqual([]);
  });

  test("replaces a socket nothing listens on", async () => {
    await staleSocketAt(path);
    const { exit, stop } = await bind({ kind: "socket", path });
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(await answer(path)).toBe("ok");
    await stop();
  });

  test("lets one of two concurrent starts over a stale socket win, and keeps its socket live", async () => {
    await staleSocketAt(path);
    const starts = await Promise.all([
      bind({ kind: "socket", path }, "first"),
      bind({ kind: "socket", path }, "second"),
    ]);
    const won = starts.filter(({ exit }) => Exit.isSuccess(exit));
    expect(won.length).toBe(1);
    expect(await answer(path)).toBe(won[0] === starts[0] ? "first" : "second");
    for (const start of starts) await start.stop();
  });

  test("removes on close only the socket it made, not one a later start put there", async () => {
    const first = await bind({ kind: "socket", path }, "first");
    if (Exit.isSuccess(first.exit)) await first.exit.value.stop(true);
    // The first server stopped; its socket is stale, and a second start replaces it.
    const second = await bind({ kind: "socket", path }, "second");
    expect(Exit.isSuccess(second.exit)).toBe(true);
    await first.stop();
    expect(await answer(path)).toBe("second");
    await second.stop();
  });

  test("refuses a socket something listens on, a link, and a file that is no socket", async () => {
    const first = await bind({ kind: "socket", path });
    expect(await refused(path)).toBe(true);
    expect(await answer(path)).toBe("ok");
    await first.stop();

    // A link to a stale socket, which a binder that followed links would take as that socket.
    const target = join(dir, "elsewhere.sock");
    await staleSocketAt(target);
    await symlink(target, path);
    expect(await refused(path)).toBe(true);
    expect((await lstat(path)).isSymbolicLink()).toBe(true);
    expect((await stat(target)).isSocket()).toBe(true);
    await rm(path);

    await writeFile(path, "not a socket");
    expect(await refused(path)).toBe(true);
    expect(await Bun.file(path).text()).toBe("not a socket");
  });

  test("is made only in a directory its owner alone can change", async () => {
    const shared = join(dir, "shared");
    await mkdir(shared);
    await chmod(shared, 0o777);
    expect(await refused(join(shared, "kb.sock"))).toBe(true);
    await chmod(shared, 0o770);
    expect(await refused(join(shared, "kb.sock"))).toBe(true);
    expect(await readdir(shared)).toEqual([]);
    expect(await refused(join(dir, "missing", "kb.sock"))).toBe(true);
  });

  test("is made only where no directory above it can be changed by another account", async () => {
    // A directory of the socket's own that would pass alone, under one another account could replace.
    for (const mode of [0o777, 0o770, 0o1777]) {
      const open = join(dir, `open-${mode.toString(8)}`);
      await mkdir(join(open, "inner"), { recursive: true, mode: 0o700 });
      await chmod(open, mode);
      expect({
        mode: mode.toString(8),
        refused: await refused(join(open, "inner", "kb.sock")),
      }).toEqual({
        mode: mode.toString(8),
        refused: true,
      });
      expect(await readdir(join(open, "inner"))).toEqual([]);
    }
  });

  test("refuses a directory reached through a link, naming the real path to use", async () => {
    const real = join(dir, "real");
    await mkdir(real, { mode: 0o700 });
    await symlink(real, join(dir, "linked"));
    const { exit, stop } = await bind({ kind: "socket", path: join(dir, "linked", "kb.sock") });
    await stop();
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit))
      expect(String(Cause.squash(exit.cause))).toContain(join(real, "kb.sock"));
    expect(await readdir(real)).toEqual([]);
    const named = await bind({ kind: "socket", path: join(real, "kb.sock") });
    expect(Exit.isSuccess(named.exit)).toBe(true);
    await named.stop();
  });
});

test("binds TCP and socket alike with an idle timeout past every request's deadline", async () => {
  const told: Record<string, unknown>[] = [];
  for (const at of [
    { kind: "tcp", hostname: "127.0.0.1", port: 0 },
    { kind: "socket", path },
  ] satisfies ServerListener[]) {
    const lifetime = Scope.makeUnsafe("sequential");
    const served = await Effect.runPromise(
      listen(at, lifetime, (where) => {
        told.push({ ...where });
        return Bun.serve({ ...where, fetch: () => new Response("ok") });
      }),
    );
    await served.stop(true);
    await Effect.runPromise(Scope.close(lifetime, Exit.void));
  }
  // requestHealth answers 503 at 35 s; Bun's default would be 10 s.
  expect(told.map((where) => where["idleTimeout"])).toEqual([45, 45]);
});
