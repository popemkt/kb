import { expect, test } from "bun:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
  realpath,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { Effect, Layer } from "effect";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import { ExtensionStorage } from "@kb/contracts";
import { extensionStorageLayer, currentData } from "../src/index.ts";
const layer = extensionStorageLayer.pipe(Layer.provide(BunFileSystem.layer));
const withStorage = <A, E>(body: (storage: ExtensionStorage["Service"]) => Effect.Effect<A, E>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* body(yield* ExtensionStorage);
    }).pipe(Effect.provide(layer)),
  );
const key = (root: string) => createHash("sha256").update(root).digest("hex");

test("local selection writes only private state; symlink paths share the canonical-root record", async () => {
  const at = await mkdtemp(join(tmpdir(), "kb-local-lock-"));
  const root = join(at, "root");
  await mkdir(root);
  const canonical = await realpath(root);
  const alias = join(at, "alias");
  await symlink(root, alias);
  try {
    await withStorage((storage) =>
      storage.mutate((tx) => tx.links(alias, "local", { add: join(at, "outside") })),
    );
    expect(await readdir(root)).toEqual([]);
    const data = await Effect.runPromise(currentData);
    const path = join(data, "extensions", "local", `${key(canonical)}.json`);
    const bytes = await readFile(path, "utf8");
    expect(JSON.parse(bytes)).toMatchObject({ root: canonical, links: [join(at, "outside")] });
    for (const spelling of [root, alias])
      expect((await withStorage((storage) => storage.read(spelling, "local"))).lock.links).toEqual([
        join(at, "outside"),
      ]);
    expect(await readFile(path, "utf8")).toBe(bytes);
    expect(await readdir(join(data, "extensions", "local"))).toEqual([`${key(canonical)}.json`]);
  } finally {
    await rm(at, { recursive: true, force: true });
  }
});
test("a local record bound to a different root is ignored without rewriting it", async () => {
  const root = await mkdtemp(join(tmpdir(), "kb-local-key-"));
  try {
    await withStorage((storage) =>
      storage.mutate((tx) => tx.links(root, "local", { add: "inside" })),
    );
    const data = await Effect.runPromise(currentData);
    const path = join(data, "extensions", "local", `${key(await realpath(root))}.json`);
    const held = JSON.parse(await readFile(path, "utf8"));
    held.root = join(root, "other");
    const forged = JSON.stringify(held);
    await writeFile(path, forged);
    const ignored = await withStorage((storage) => storage.read(root, "local"));
    expect(ignored.lock.links).toEqual([]);
    expect(ignored.failures).toEqual([{ file: path, error: expect.stringContaining("ignored") }]);
    expect(await readFile(path, "utf8")).toBe(forged);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
for (const replacement of ["missing", "symlink"] as const)
  test(`a moved root starts empty and its ${replacement} replacement leaves an orphaned private record`, async () => {
    const at = await mkdtemp(join(tmpdir(), "kb-local-moved-"));
    const root = join(at, "before");
    const moved = join(at, "after");
    await mkdir(root);
    const canonical = await realpath(root);
    try {
      await withStorage((storage) =>
        storage.mutate((tx) => tx.links(root, "local", { add: "inside" })),
      );
      await rename(root, moved);
      if (replacement === "symlink") {
        const other = join(at, "other");
        await mkdir(other);
        await symlink(other, root);
        expect((await withStorage((storage) => storage.read(root, "local"))).lock.links).toEqual(
          [],
        );
      }
      expect((await withStorage((storage) => storage.read(moved, "local"))).lock.links).toEqual([]);
      const data = await Effect.runPromise(currentData);
      const path = join(data, "extensions", "local", `${key(canonical)}.json`);
      const bytes = await readFile(path, "utf8");
      const result = await withStorage((storage) =>
        storage.mutate((tx) => tx.collection([moved]).pipe(Effect.flatMap((plan) => plan.sweep))),
      );
      expect(result.orphanedLocalLocks).toEqual([{ path, root: canonical }]);
      expect(await readFile(path, "utf8")).toBe(bytes);
    } finally {
      await rm(at, { recursive: true, force: true });
    }
  });
