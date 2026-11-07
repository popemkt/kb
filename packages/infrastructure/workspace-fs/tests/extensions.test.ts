import { expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import { Effect, Exit, Layer } from "effect";
import { checkedTree } from "@kb/extension-source";
import { ExtensionStorage } from "@kb/contracts";
import { currentData, extensionStorageLayer } from "../src/index.ts";
const storageLayer = extensionStorageLayer.pipe(Layer.provide(BunFileSystem.layer));
const pin = { repo: "owner/repo", path: "extensions/hello", rev: "a".repeat(40) };
const source = () =>
  Effect.runPromise(
    checkedTree([
      {
        path: "hello.ts",
        mode: "100644",
        bytes: new TextEncoder().encode("export const value = 42;"),
      },
    ]),
  );

test("cache verifies regular immutable files and repairs tampering without following links", async () => {
  const tree = await source();
  const outside = await mkdtemp(join(tmpdir(), "kb-outside-"));
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const storage = yield* ExtensionStorage;
        expect(yield* storage.cached(pin)).toBeNull();
        const cached = yield* storage.store(pin, tree);
        expect((yield* storage.cached(pin))?.dir).toBe(cached.dir);
        yield* Effect.promise(async () => {
          expect((await stat(join(cached.dir, "hello.ts"))).mode & 0o222).toBe(0);
          expect((await stat(cached.dir)).mode & 0o222).toBe(0);
          await chmod(cached.dir, 0o700);
          await unlink(join(cached.dir, "hello.ts"));
          await writeFile(join(outside, "kept.ts"), "do not change");
          await symlink(join(outside, "kept.ts"), join(cached.dir, "hello.ts"));
        });
        expect(Exit.isFailure(yield* Effect.exit(storage.tree(tree.name, tree.hash)))).toBe(true);
        expect(yield* storage.cached(pin)).toBeNull();
        yield* storage.store(pin, tree);
        expect((yield* storage.tree(tree.name, tree.hash))?.dir).toBe(cached.dir);
        expect(yield* Effect.promise(() => readFile(join(outside, "kept.ts"), "utf8"))).toBe(
          "do not change",
        );
      }).pipe(Effect.provide(storageLayer)),
    );
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test("concurrent selection writes preserve entries in each scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "kb-locks-"));
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const storage = yield* ExtensionStorage;
        for (const scope of ["store", "local", "user"] as const) {
          yield* Effect.all(
            ["one", "two"].map((name) =>
              storage.update(root, scope, (held) => ({
                ...held,
                extensions: {
                  ...held.extensions,
                  [name]: {
                    original: "github:owner/repo",
                    locked: { ...pin, files: `sha256:${"a".repeat(64)}` },
                  },
                },
              })),
            ),
            { concurrency: 2 },
          );
          expect(Object.keys((yield* storage.read(root, scope)).extensions).toSorted()).toEqual([
            "one",
            "two",
          ]);
        }
      }).pipe(Effect.provide(storageLayer)),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("invalid lock schema is refused without replacement", async () => {
  const root = await mkdtemp(join(tmpdir(), "kb-bad-lock-"));
  try {
    await mkdir(join(root, ".kb"));
    const file = join(root, ".kb", "extensions.lock.json");
    const body = '{"version":2}';
    await writeFile(file, body);
    await Effect.runPromise(
      Effect.gen(function* () {
        const storage = yield* ExtensionStorage;
        expect(
          Exit.isFailure(yield* Effect.exit(storage.update(root, "store", (held) => held))),
        ).toBe(true);
      }).pipe(Effect.provide(storageLayer)),
    );
    expect(await readFile(file, "utf8")).toBe(body);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the pin index is versioned and an unknown version is a read-only cache miss", async () => {
  const tree = await source();
  await Effect.runPromise(
    Effect.gen(function* () {
      const storage = yield* ExtensionStorage;
      yield* storage.store(pin, tree);
      const data = yield* currentData;
      const dir = join(data, "extensions", "refs");
      const files = yield* Effect.promise(() => readdir(dir));
      const name = files.at(0);
      if (name === undefined) throw new Error("missing pin record");
      const path = join(dir, name);
      const original = yield* Effect.promise(() => readFile(path, "utf8"));
      const record = JSON.parse(original) as { version: number };
      expect(record.version).toBe(1);
      const future = JSON.stringify({ ...record, version: 2 });
      yield* Effect.promise(() => writeFile(path, future));
      expect(yield* storage.cached(pin)).toBeNull();
      expect(yield* Effect.promise(() => readFile(path, "utf8"))).toBe(future);
    }).pipe(Effect.provide(storageLayer)),
  );
});
test("store links stay inside the repo, including missing paths through symlink ancestors", async () => {
  const at = await mkdtemp(join(tmpdir(), "kb-store-link-"));
  const root = join(at, "repo");
  const sibling = join(at, "sibling");
  await mkdir(join(root, "inside"), { recursive: true });
  await mkdir(sibling);
  await symlink(sibling, join(root, "outside"));
  await symlink(join(root, "inside"), join(root, "alias"));
  const file = join(root, ".kb", "extensions.lock.json");
  await mkdir(join(root, ".kb"));
  try {
    for (const path of ["../sibling", "outside", "outside/missing", sibling]) {
      const body = JSON.stringify({ version: 1, extensions: {}, marketplaces: {}, links: [path] });
      await writeFile(file, body);
      await Effect.runPromise(
        Effect.gen(function* () {
          const storage = yield* ExtensionStorage;
          expect(Exit.isFailure(yield* Effect.exit(storage.read(root, "store")))).toBe(true);
          expect(
            Exit.isFailure(yield* Effect.exit(storage.update(root, "store", (held) => held))),
          ).toBe(true);
        }).pipe(Effect.provide(storageLayer)),
      );
      expect(await readFile(file, "utf8")).toBe(body);
    }
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        extensions: {},
        marketplaces: {},
        links: ["alias", "inside/missing"],
      }),
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        const storage = yield* ExtensionStorage;
        expect((yield* storage.read(root, "store")).links).toEqual(["alias", "inside/missing"]);
        for (const scope of ["local", "user"] as const) {
          yield* storage.update(root, scope, (held) => ({ ...held, links: [sibling] }));
          expect((yield* storage.read(root, scope)).links).toEqual([sibling]);
        }
      }).pipe(Effect.provide(storageLayer)),
    );
  } finally {
    await rm(at, { recursive: true, force: true });
  }
});
