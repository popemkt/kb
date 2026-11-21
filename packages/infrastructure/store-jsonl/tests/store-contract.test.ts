/**
 * JsonlStore against the shared store contract. The properties live in
 * `@kb/test-kit` because they are the port's, not this adapter's; what is
 * specific to JSONL — the `.lock` file, `.bak` rotation, line-numbered decode
 * errors — is tested where that behaviour is described.
 */
import { expect, test } from "bun:test";
import { Effect, Fiber } from "effect";
import { acquireFileWriteLockEffect, releaseFileWriteLock } from "@kb/file-write";
import { logContract, storeContract, tailContract, reactionContract } from "@kb/test-kit";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlStore, txTailPath } from "../src/index.ts";

storeContract("JsonlStore", {
  makeStore: (root) => new JsonlStore(root),
  holdWriteLock: {
    cwd: import.meta.dir,
    script: `
      import { Effect } from "effect";
      import { acquireFileWriteLockEffect } from "@kb/file-write";
      await Effect.runPromise(acquireFileWriteLockEffect(path));
    `,
  },
});
reactionContract("JsonlStore", (root) => new JsonlStore(root));

const scratchRoot = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "kb-tail-contract-"))),
  (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
);

tailContract(
  "JsonlTxTail",
  Effect.map(scratchRoot, (root) => new JsonlStore(root).txTail),
);

logContract("JsonlStore", {
  makeStore: (root) => new JsonlStore(root),
  // Simulate a writer that did not record its changes.
  dropLastRecord: (root) => {
    const path = txTailPath(root);
    const lines = readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0);
    writeFileSync(
      path,
      lines
        .slice(0, -1)
        .map((line) => `${line}\n`)
        .join(""),
    );
  },
  // The write-ahead record cannot replace a directory.
  breakTail: (root) => {
    mkdirSync(new JsonlStore(root).txTail.pendingPath);
  },
});

test("a virtual append waits for the node writer's lock before allocating its revision", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const store = new JsonlStore(yield* scratchRoot);
        const at = "2026-01-01T00:00:00.000Z";
        const ops = { upserts: [], deletes: [] };
        const release = yield* Effect.forkScoped(
          Effect.scoped(
            Effect.gen(function* () {
              yield* Effect.acquireRelease(acquireFileWriteLockEffect(store.path), (lock) =>
                Effect.sync(() => releaseFileWriteLock(lock)),
              );
              yield* Effect.sleep("100 millis");
            }),
          ),
          { startImmediately: true },
        );
        const append = yield* Effect.forkScoped(store.txTail.append(ops, { at }), {
          startImmediately: true,
        });
        expect(store.txTail.head()).toBe(0);
        yield* Fiber.join(release);
        expect((yield* Fiber.join(append)).rev).toBe(1);
      }),
    ),
  ));

test("a published journal survives failed archiving and is recovered exactly once", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* scratchRoot;
        const store = new JsonlStore(root);
        const at = "2026-01-01T00:00:00.000Z";
        mkdirSync(join(root, ".kb"));
        writeFileSync(store.txTail.path, "");
        chmodSync(store.txTail.path, 0o444);

        const node = { id: "a", text: "a", props: {}, children: [], createdAt: at, updatedAt: at };
        const { record } = yield* store.commitEffect({ upserts: [node], deletes: [] }, { at });
        if (record === null) throw new Error("expected the graph commit to have a record");
        const reopened = new JsonlStore(root);
        expect((yield* reopened.loadEffect).map(({ id }) => id)).toEqual(["a"]);
        expect(reopened.txTail.entries()).toEqual([record]);
        expect(reopened.txTail.isCurrent()).toBe(true);

        // A process dying halfway through an archive can leave a torn line.
        chmodSync(store.txTail.path, 0o644);
        writeFileSync(store.txTail.path, '{"rev":1');
        const virtual = yield* reopened.txTail.append({ upserts: [], deletes: [] }, { at });
        expect(new JsonlStore(root).txTail.entries()).toEqual([record, virtual]);
        expect(virtual.rev).toBe(2);
      }),
    ),
  ));

test("a prepared record stays invisible if the node replacement fails", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* scratchRoot;
        const store = new JsonlStore(root);
        const at = "2026-01-01T00:00:00.000Z";
        const node = { id: "a", text: "a", props: {}, children: [], createdAt: at, updatedAt: at };
        yield* store.commitEffect({ upserts: [node], deletes: [] }, { at });
        mkdirSync(store.backupPath);
        const failed = yield* Effect.result(
          store.commitEffect({ upserts: [{ ...node, text: "lost" }], deletes: [] }, { at }),
        );
        expect(failed._tag).toBe("Failure");

        const reopened = new JsonlStore(root);
        expect((yield* reopened.loadEffect)[0]?.text).toBe("a");
        expect(reopened.txTail.head()).toBe(1);
        expect(reopened.txTail.isCurrent()).toBe(true);
        const virtual = yield* reopened.txTail.append({ upserts: [], deletes: [] }, { at });
        expect(virtual.rev).toBe(2);
        expect(new JsonlStore(root).txTail.entries().map(({ rev }) => rev)).toEqual([1, 2]);
      }),
    ),
  ));
