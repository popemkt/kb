/** Lock and trust observation is read-only and notices replacements by another process. */
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Duration, Effect, Layer, Option, Queue, Stream } from "effect";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import { CodeTrust, ExtensionStorage, STORE_CHANGES_POLL } from "@kb/contracts";
import { codeTrustLayer, currentData, extensionStorageLayer } from "../src/index.ts";

const layer = Layer.merge(codeTrustLayer("watch-contract"), extensionStorageLayer).pipe(
  Layer.provide(BunFileSystem.layer),
);
const adapter = new URL("../src/index.ts", import.meta.url).pathname;
const within = Duration.times(STORE_CHANGES_POLL, 3);

for (const kind of ["trust", "local", "store", "user"] as const)
  test(`${kind} changes: observing creates nothing and replacements from another process arrive`, async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-config-watch-"));
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const storage = yield* ExtensionStorage;
            const trust = yield* CodeTrust;
            const changes = kind === "trust" ? trust.changes : storage.changes(root);
            const announced = yield* Queue.unbounded<number>();
            let count = 0;
            yield* Stream.runForEach(changes, () =>
              Effect.sync(() => Queue.offerUnsafe(announced, ++count)),
            ).pipe(Effect.forkScoped);
            const next = Queue.take(announced).pipe(Effect.timeoutOption(within));
            expect(yield* next).toEqual(Option.some(1));
            expect(yield* Effect.sync(() => existsSync(join(root, ".kb")))).toBe(false);
            const data = yield* currentData;
            expect(yield* Effect.sync(() => existsSync(data))).toBe(false);
            for (const n of [1, 2]) {
              const operation =
                kind === "trust"
                  ? `Effect.flatMap(CodeTrust, t => t.trust("sha256:${String(n).repeat(64)}"))`
                  : `Effect.flatMap(ExtensionStorage, s => s.mutate(tx => tx.links(${JSON.stringify(root)}, ${JSON.stringify(kind)}, {add:${JSON.stringify(join(root, `folder-${n}`))}})))`;
              const script = `import {Effect,Layer} from "effect";
                import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
                import {CodeTrust,ExtensionStorage} from "@kb/contracts";
                import {codeTrustLayer,extensionStorageLayer} from ${JSON.stringify(adapter)};
                await Effect.runPromise(${operation}.pipe(Effect.provide(
                  Layer.merge(codeTrustLayer("watch-contract"),extensionStorageLayer).pipe(Layer.provide(BunFileSystem.layer))
                )));`;
              yield* Effect.promise(async () => {
                const child = Bun.spawn(
                  [process.execPath, "--no-env-file", "--config=/dev/null", "--eval", script],
                  {
                    cwd: new URL("..", import.meta.url).pathname,
                    env: { ...process.env, KB_DATA: data },
                    stdout: "pipe",
                    stderr: "pipe",
                  },
                );
                const [code, error] = await Promise.all([
                  child.exited,
                  new Response(child.stderr).text(),
                ]);
                expect(error).toBe("");
                expect(code).toBe(0);
              });
              if (kind === "trust")
                expect(yield* trust.trusted([`sha256:${String(n).repeat(64)}`])).toHaveLength(1);
              else expect((yield* storage.read(root, kind)).lock.links).toHaveLength(n);
              expect(yield* next).toEqual(Option.some(n + 1));
            }
          }),
        ).pipe(Effect.provide(layer)),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
