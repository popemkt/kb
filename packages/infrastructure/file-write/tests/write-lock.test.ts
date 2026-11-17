import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
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

/**
 * A Bun process's argv that executes `body` with a lock API imported: this
 * one, or an older kb's.
 */
const lockArgv = (body: string, lockModule = "./src/index.ts") => [
  process.execPath,
  "-e",
  `
      import { Effect } from "effect";
      import { readFileSync, writeFileSync } from "node:fs";
      import { acquireFileWriteLockEffect, releaseFileWriteLock } from ${JSON.stringify(lockModule)};
      const file = ${JSON.stringify(file)};
      ${body}
    `,
];
/** Run from this package, so the lock modules resolve. */
const PACKAGE_DIR = join(import.meta.dir, "..");

/** Read the counter, yield, and write it back plus one: a second holder loses an increment. */
const increments = (each: number) => `
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
      }`;

/** A child's stdout as it arrives, so a test can wait for a line or see it has not come. */
function watchOutput(stdout: ReadableStream<Uint8Array>) {
  let text = "";
  void (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of stdout) text += decoder.decode(chunk, { stream: true });
  })();
  const seen = (line: string) => text.split("\n").includes(line);
  return {
    seen,
    until: async (line: string) => {
      while (!seen(line)) await Bun.sleep(10);
    },
  };
}

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
      Bun.spawn(lockArgv(increments(each)), {
        cwd: PACKAGE_DIR,
        stdout: "ignore",
        stderr: "pipe",
      }),
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

  test("a symbolic link at the lock path fails the write and leaves the file it names alone", async () => {
    const named = join(dir, "someone-elses-file");
    writeFileSync(named, "keep me\n");
    symlinkSync(named, lockPathFor(file));
    const exit = await Effect.runPromiseExit(acquireFileWriteLockEffect(file));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(Cause.squash(exit.cause))).toContain("is a symbolic link, not a lock file");
    }
    expect(readFileSync(named, "utf8")).toBe("keep me\n");
  });

  test("an empty lock file is an older kb writing its pid while young, and nobody's once old", async () => {
    // The released lock creates its file empty and writes its pid after.
    writeFileSync(lockPathFor(file), "");
    const waiter = Effect.runFork(acquireFileWriteLockEffect(file));
    await Bun.sleep(300);
    expect(waiter.pollUnsafe()).toBeUndefined();
    await Effect.runPromise(Fiber.interrupt(waiter));
    utimesSync(lockPathFor(file), 0, 0);
    const lock = await Effect.runPromise(acquireFileWriteLockEffect(file));
    expect(readFileSync(lock, "utf8").trim()).toBe(String(process.pid));
    releaseFileWriteLock(lock);
  });
});

/*
 * During an update an older kb, which takes no flock and holds the lock by
 * its pid in the file, runs beside this one. Each is run here as a real
 * process against the other. Goes with the older-writer reading (todo
 * 01M7K50TFYFRWRJBTQ8V76489P).
 */
describe.each([
  { kb: "the released pid-file lock", lockModule: "./tests/older/released.ts" },
  { kb: "#267's linked pid-file lock", lockModule: "./tests/older/linked.ts" },
])("an older kb beside this one ($kb)", ({ lockModule }) => {
  test("an older kb holding the lock keeps this one out until it lets go", async () => {
    const older = Bun.spawn(
      lockArgv(
        `
      const lock = await Effect.runPromise(acquireFileWriteLockEffect(file));
      console.log("held");
      await Bun.stdin.text();
      releaseFileWriteLock(lock);`,
        lockModule,
      ),
      { cwd: PACKAGE_DIR, stdin: "pipe", stdout: "pipe", stderr: "pipe" },
    );
    await watchOutput(older.stdout).until("held");
    const waiter = Effect.runFork(acquireFileWriteLockEffect(file));
    await Bun.sleep(300);
    expect(waiter.pollUnsafe()).toBeUndefined();
    await older.stdin.end();
    expect(await older.exited).toBe(0);
    const lock = await Effect.runPromise(Fiber.join(waiter));
    expect(readFileSync(lock, "utf8").trim()).toBe(String(process.pid));
    releaseFileWriteLock(lock);
  });

  test("this one holding the lock keeps an older kb out until it lets go", async () => {
    const lock = await Effect.runPromise(acquireFileWriteLockEffect(file));
    const older = Bun.spawn(
      lockArgv(
        `
      console.log("waiting");
      const lock = await Effect.runPromise(acquireFileWriteLockEffect(file));
      console.log("held");
      releaseFileWriteLock(lock);`,
        lockModule,
      ),
      { cwd: PACKAGE_DIR, stdout: "pipe", stderr: "pipe" },
    );
    const output = watchOutput(older.stdout);
    await output.until("waiting");
    await Bun.sleep(300);
    expect(output.seen("held")).toBe(false);
    releaseFileWriteLock(lock);
    await output.until("held");
    expect(await older.exited).toBe(0);
  });

  test("an older kb's live lock times this one out, naming it", async () => {
    const older = Bun.spawn(
      lockArgv(
        `
      await Effect.runPromise(acquireFileWriteLockEffect(file));
      console.log("held");
      await Bun.stdin.text();`,
        lockModule,
      ),
      { cwd: PACKAGE_DIR, stdin: "pipe", stdout: "pipe", stderr: "pipe" },
    );
    await watchOutput(older.stdout).until("held");
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const waiter = yield* Effect.forkChild(acquireFileWriteLockEffect(file));
        yield* TestClock.adjust(15_100);
        return yield* Fiber.await(waiter);
      }).pipe(Effect.provide(TestClock.layer())),
    );
    await older.stdin.end();
    await older.exited;
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(Cause.squash(exit.cause))).toContain(
        `held by pid ${older.pid}, an older kb that does not take the kernel lock`,
      );
    }
  });

  // One older writer: two of them could still race each other, as before.
  test("writers of both kinds never lose a write", async () => {
    const each = 20;
    const children = [
      Bun.spawn(lockArgv(increments(each), lockModule), {
        cwd: PACKAGE_DIR,
        stdout: "ignore",
        stderr: "pipe",
      }),
      ...Array.from({ length: 3 }, () =>
        Bun.spawn(lockArgv(increments(each)), {
          cwd: PACKAGE_DIR,
          stdout: "ignore",
          stderr: "pipe",
        }),
      ),
    ];
    for (const child of children) expect(await child.exited).toBe(0);
    expect(Number(readFileSync(file, "utf8"))).toBe(children.length * each);
  });
});
