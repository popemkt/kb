import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Fiber } from "effect";
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

describe("file write lock", () => {
  /*
   * Each process reads the counter, yields, and writes it back plus one, all
   * under the lock. A second holder at any moment loses an increment. Before
   * the lock was created whole, a lock read between its creation and its pid
   * looked dead, and this lost one in most runs of 6 x 40.
   */
  test("writers in separate processes never lose a write", async () => {
    const processes = 6;
    const each = 25;
    const children = Array.from({ length: processes }, () =>
      Bun.spawn(
        [
          process.execPath,
          "-e",
          `
      import { Effect } from "effect";
      import { readFileSync, writeFileSync } from "node:fs";
      import { acquireFileWriteLockEffect, releaseFileWriteLock } from "./src/index.ts";
      const file = ${JSON.stringify(file)};
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
      }
    `,
        ],
        { cwd: join(import.meta.dir, ".."), stdout: "ignore", stderr: "pipe" },
      ),
    );
    for (const child of children) expect(await child.exited).toBe(0);
    expect(Number(readFileSync(file, "utf8"))).toBe(processes * each);
  });

  test("a lock whose holder has not written its pid yet is not stolen", async () => {
    // What another writer sees between creating a lock and writing its pid.
    writeFileSync(lockPathFor(file), "");
    const writtenAt = statSync(lockPathFor(file)).mtimeMs;
    const taken = await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(writtenAt);
        const acquire = yield* Effect.forkChild(acquireFileWriteLockEffect(file));
        yield* TestClock.adjust(1_000);
        return acquire.pollUnsafe();
      }).pipe(Effect.provide(TestClock.layer())),
    );
    expect(taken).toBeUndefined();
  });

  test("a lock left with no pid is stale once it is older than a writer needs", async () => {
    writeFileSync(lockPathFor(file), "");
    const writtenAt = statSync(lockPathFor(file)).mtimeMs;
    const lock = await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(writtenAt);
        const acquire = yield* Effect.forkChild(acquireFileWriteLockEffect(file));
        yield* TestClock.adjust(2_500);
        return yield* Fiber.join(acquire);
      }).pipe(Effect.provide(TestClock.layer())),
    );
    expect(readFileSync(lock, "utf8").trim()).toBe(String(process.pid));
    releaseFileWriteLock(lock);
  });

  test("a lock held by a live process is waited on, and released only by its holder", async () => {
    writeFileSync(lockPathFor(file), `${process.ppid}\n`);
    releaseFileWriteLock(lockPathFor(file));
    expect(readFileSync(lockPathFor(file), "utf8").trim()).toBe(String(process.ppid));
    const taken = await Effect.runPromise(
      Effect.gen(function* () {
        const acquire = yield* Effect.forkChild(acquireFileWriteLockEffect(file));
        yield* TestClock.adjust(5_000);
        return acquire.pollUnsafe();
      }).pipe(Effect.provide(TestClock.layer())),
    );
    expect(taken).toBeUndefined();
  });

  test("a lock whose holder has died is taken", async () => {
    // Pid 2^22 + 1 is above Linux's pid_max ceiling, so no process holds it.
    writeFileSync(lockPathFor(file), `${2 ** 22 + 1}\n`);
    const lock = await Effect.runPromise(acquireFileWriteLockEffect(file));
    expect(readFileSync(lock, "utf8").trim()).toBe(String(process.pid));
    releaseFileWriteLock(lock);
  });
});
