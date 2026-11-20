/**
 * Local stores through a real kb: a root added as a location, opened on a
 * `kb ui` this app had to start (reused on a second open), and that host
 * stopped when the app settles, while a host that replaced it is left alone.
 *
 * The child runs with `KB_PKG_ROOT` at an empty directory, as serve.test.ts
 * does: no UI to build, so the server serves its API at once.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { BunFileSystem } from "@effect/platform-bun";
import { KB_SOURCE_BIN } from "@kb/test-kit";
import { currentHome, readUiPresence } from "@kb/workspace-fs";
import { Effect, Layer } from "effect";
import {
  DesktopConfig,
  DeviceSettings,
  kbEnvironment,
  kbProcessRunner,
  KbCli,
  StoreDirectory,
  type KbRunner,
  type Stores,
} from "../src/index.ts";

let scratch = "";
afterEach(() => {
  if (scratch !== "") rmSync(scratch, { recursive: true, force: true });
});

async function answers(origin: string): Promise<boolean> {
  try {
    return (await fetch(`${origin}/api/identity`, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}

/** A store directory over a real kb in a fresh scratch directory, with the root Alpha added. */
async function alphaStore(): Promise<{ kb: KbRunner; stores: Stores; root: string }> {
  // Its real path, as kb records a location by (macOS links /tmp to /private/tmp).
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "kb-desktop-stores-")));
  const pkg = join(scratch, "pkg");
  mkdirSync(pkg);
  const root = join(scratch, "alpha");
  const kb = kbProcessRunner(KB_SOURCE_BIN, {
    env: kbEnvironment(
      { path: process.env.PATH, home: homedir(), user: process.env.USER },
      { KB_PKG_ROOT: pkg },
    ),
  });
  const stores = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* StoreDirectory;
    }).pipe(
      Effect.provide(
        StoreDirectory.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(KbCli, kb),
              Layer.succeed(DeviceSettings, new DesktopConfig(join(scratch, "desktop"))),
            ),
          ),
        ),
      ),
    ),
  );
  await Effect.runPromise(stores.addLocal(root, "Alpha"));
  return { kb, stores, root };
}

/** The pid `root`'s presence names now. */
async function hostPid(root: string): Promise<number> {
  const presence = await Effect.runPromise(
    readUiPresence(root).pipe(Effect.provide(BunFileSystem.layer)),
  );
  return presence?.pid ?? 0;
}

/** Stop the process `pid` and wait until it has gone. */
async function stopProcess(pid: number): Promise<void> {
  process.kill(pid, "SIGTERM");
  for (let i = 0; i < 100; i += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await Bun.sleep(100);
  }
}

describe("Stores over a real kb", () => {
  test("add, list, open (start, then reuse) and stop what it started", async () => {
    const { stores } = await alphaStore();
    const alpha = (await Effect.runPromise(stores.list)).find((s) => s.name === "Alpha");
    expect(alpha).toMatchObject({ kind: "local", name: "Alpha", status: "closed" });
    if (alpha === undefined) return;

    const origin = await Effect.runPromise(stores.origin(alpha));
    expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(await answers(origin)).toBe(true);
    expect(stores.started()).toHaveLength(1);
    // A second open reuses the host kb now finds serving the root.
    expect(await Effect.runPromise(stores.origin(alpha))).toBe(origin);

    const [root0] = stores.started();
    await Effect.runPromise(stores.stopStarted(root0 ?? ""));
    expect(await answers(origin)).toBe(false);
    expect(stores.started()).toEqual([]);
  }, 60_000);

  test("a host that replaced the one this app started is not stopped", async () => {
    const { kb, stores, root } = await alphaStore();
    const alpha = (await Effect.runPromise(stores.list)).find((s) => s.name === "Alpha");
    if (alpha === undefined) throw new Error("Alpha is not listed");
    const first = await Effect.runPromise(stores.origin(alpha));
    // Host A goes away, and someone else starts host B for the same root.
    await stopProcess(await hostPid(root));
    expect(await answers(first)).toBe(false);
    const home = await Effect.runPromise(currentHome);
    const reopened = await Effect.runPromise(kb.run(home, ["open", alpha.key, "--no-browser"]));
    expect(reopened.status).toBe("succeeded");
    const b = await hostPid(root);
    expect(b).toBeGreaterThan(0);

    await Effect.runPromise(stores.stopStarted(root));
    expect(stores.started()).toEqual([]);
    expect(() => process.kill(b, 0)).not.toThrow();
    await stopProcess(b);
  }, 60_000);
});
