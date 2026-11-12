import { expect, test } from "bun:test";
import { Effect, Exit, Fiber, Scope } from "effect";
import * as FileSystem from "effect/FileSystem";
import { listen } from "../src/listener.ts";

function pendingStep() {
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    waiting,
    release: () => release(),
    run: Effect.fn("listenerTest.pending")(function* () {
      entered();
      yield* Effect.promise(() => pending);
    }),
  };
}

test("socket preflight can be interrupted without waiting for a filesystem lookup", async () => {
  const step = pendingStep();
  let bound = false;
  const fs = FileSystem.layerNoop({
    stat: Effect.fn("listenerTest.stat")(function* () {
      yield* step.run();
      return yield* Effect.die("released pending stat");
    }),
  });
  const scope = Scope.makeUnsafe();
  const fiber = Effect.runFork(
    listen(
      { kind: "socket", path: "/tmp/kb-never-bound.sock", origin: "http://localhost" },
      scope,
      () => {
        bound = true;
        return { stop: () => {} };
      },
    ).pipe(Effect.provide(fs)),
  );
  await step.waiting;
  let settled = false;
  const interrupted = Effect.runPromise(Fiber.interrupt(fiber)).then(() => {
    settled = true;
    return true;
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(settled).toBe(true);
    expect(bound).toBe(false);
  } finally {
    step.release();
    await interrupted;
    await Effect.runPromise(Scope.close(scope, Exit.void));
  }
});

test("socket permissions remain interruptible after the listener and its unlink are owned", async () => {
  const step = pendingStep();
  let stopped = 0;
  let unlinked = 0;
  const fs = FileSystem.layerNoop({
    chmod: step.run,
    remove: Effect.fn("listenerTest.unlink")(function* () {
      yield* Effect.sync(() => {
        unlinked++;
      });
    }),
  });
  const scope = Scope.makeUnsafe();
  const fiber = Effect.runFork(
    listen(
      { kind: "socket", path: "/tmp/kb-owned.sock", origin: "http://localhost" },
      scope,
      () => ({
        stop: () => {
          stopped++;
        },
      }),
    ).pipe(Effect.provide(fs)),
  );
  try {
    await step.waiting;
    expect(stopped).toBe(0);
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(stopped).toBe(1);
    expect(unlinked).toBe(1);
    await Effect.runPromise(Scope.close(scope, Exit.void));
    expect(stopped).toBe(1);
  } finally {
    step.release();
    await Effect.runPromise(Fiber.interrupt(fiber));
    await Effect.runPromise(Scope.close(scope, Exit.void));
  }
});
