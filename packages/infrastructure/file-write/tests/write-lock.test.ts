import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cause, Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { acquireFileWriteLockEffect, lockPathFor, releaseFileWriteLock } from "../src/index.ts";

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kb-write-lock-"));
  file = join(dir, "counter");
  writeFileSync(file, "0");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A Bun process's argv that executes `body` with the lock API imported. */
const lockArgv = (body: string) => [
  process.execPath,
  "-e",
  `
      import { Effect } from "effect";
      import { readFileSync, writeFileSync } from "node:fs";
      import { acquireFileWriteLockEffect, releaseFileWriteLock } from "./src/index.ts";
      const file = ${JSON.stringify(file)};
      ${body}
    `,
];
/** Run from this package, so `./src/index.ts` resolves. */
const PACKAGE_DIR = join(import.meta.dir, "..");

describe("file write lock", () => {
  /*
   * Each process reads the counter, yields, and writes it back plus one, all
   * under the lock. A second holder at any moment loses an increment. The
   * pid-file lock this replaced lost one in most runs of 6 x 40.
   */
  test("writers in separate processes never lose a write", async () => {
    const processes = 6;
    const each = 25;
    const children = Array.from({ length: processes }, () =>
      Bun.spawn(
        lockArgv(`
      for (let i = 0; i < ${each}; i++) {
        await Effect.runPromise(Effect.acquireUseRelease(
          acquireFileWriteLockEffect(file),
          () => Effect.promise(async () => {
            const n = Number(readFileSync(file, "utf8"));
            await new Promise((resolve) => setTimeout(resolve, 0));
            writeFileSync(file, String(n + 1));
          }),
          (lock) => Effect.sync(() => releaseFileWriteLock(lock)),
        ));
      }`),
        { cwd: PACKAGE_DIR, stdout: "ignore", stderr: "pipe" },
      ),
    );
    for (const child of children) expect(await child.exited).toBe(0);
    expect(Number(readFileSync(file, "utf8"))).toBe(processes * each);
  });

  test("a holder that dies frees the lock, with nothing to judge stale", async () => {
    const holder = Bun.spawn(
      lockArgv(`
      await Effect.runPromise(acquireFileWriteLockEffect(file));
      console.log("held");
      await new Promise(() => {});`),
      { cwd: PACKAGE_DIR, stdout: "pipe", stderr: "pipe" },
    );
    const reader = holder.stdout.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain("held");
    holder.kill("SIGKILL");
    await holder.exited;
    // The lock file stays, naming the dead holder; it is not held.
    expect(existsSync(lockPathFor(file))).toBe(true);
    const lock = await Effect.runPromise(acquireFileWriteLockEffect(file));
    expect(readFileSync(lock, "utf8").trim()).toBe(String(process.pid));
    releaseFileWriteLock(lock);
  });

  test("two acquirers in one process: the second waits, then locks the file at the path", async () => {
    const order = await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* acquireFileWriteLockEffect(file);
        const second = yield* Effect.forkChild(acquireFileWriteLockEffect(file));
        yield* TestClock.adjust(1_000);
        const whileHeld = second.pollUnsafe();
        releaseFileWriteLock(first);
        yield* TestClock.adjust(25);
        // The second was waiting on the file the first removed as it let go;
        // what it holds is the lock file at the path now.
        const lock = yield* Fiber.join(second);
        expect(readFileSync(lock, "utf8").trim()).toBe(String(process.pid));
        releaseFileWriteLock(lock);
        expect(existsSync(lock)).toBe(false);
        return whileHeld;
      }).pipe(Effect.provide(TestClock.layer())),
    );
    expect(order).toBeUndefined();
  });

  test("a waiter gives up after the ceiling, naming the holder", async () => {
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* acquireFileWriteLockEffect(file);
        const waiter = yield* Effect.forkChild(acquireFileWriteLockEffect(file));
        yield* TestClock.adjust(15_100);
        const result = yield* Fiber.await(waiter);
        releaseFileWriteLock(first);
        return result;
      }).pipe(Effect.provide(TestClock.layer())),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(Cause.squash(exit.cause))).toContain(`held by pid ${process.pid}`);
    }
  });

  test("a lock file left behind is not a held lock", async () => {
    writeFileSync(lockPathFor(file), "999999999\n");
    const lock = await Effect.runPromise(acquireFileWriteLockEffect(file));
    expect(readFileSync(lock, "utf8").trim()).toBe(String(process.pid));
    releaseFileWriteLock(lock);
    expect(existsSync(lock)).toBe(false);
  });
});
