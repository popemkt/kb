/**
 * Local stores through a real kb: a root added as a location, opened on a
 * `kb ui` this app had to start (reused on a second open), and that host
 * stopped when the app settles, while one it found serving is left alone.
 *
 * The child runs with `KB_PKG_ROOT` at an empty directory, as serve.test.ts
 * does: no UI to build, so the server serves its API at once.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KB_SOURCE_BIN } from "@kb/test-kit";
import { Effect, Layer } from "effect";
import {
  DesktopConfig,
  DeviceSettings,
  kbProcessRunner,
  KbCli,
  StoreDirectory,
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

describe("Stores over a real kb", () => {
  test("add, list, open (start, then reuse) and stop what it started", async () => {
    scratch = mkdtempSync(join(tmpdir(), "kb-desktop-stores-"));
    const pkg = join(scratch, "pkg");
    mkdirSync(pkg);
    const root = join(scratch, "alpha");
    const kb = kbProcessRunner(KB_SOURCE_BIN, { env: { KB_PKG_ROOT: pkg } });
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
});
