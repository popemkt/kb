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
import { checkedTree, extensionTree, checkedExtensionTree } from "@kb/extension-source";
import { ExtensionStorage } from "@kb/contracts";
import { currentData, extensionStorageLayer } from "../src/index.ts";
const storageLayer = extensionStorageLayer.pipe(Layer.provide(BunFileSystem.layer));
const pin = { repo: "owner/repo", path: "extensions/hello", rev: "a".repeat(40) };
const source = () =>
  Effect.runPromise(
    checkedExtensionTree([
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
        expect(yield* storage.cached({ kind: "extension", pin })).toBeNull();
        const cached = yield* storage.mutate((tx) => tx.store({ kind: "extension", pin }, tree));
        expect((yield* storage.cached({ kind: "extension", pin }))?.dir).toBe(cached.dir);
        yield* Effect.promise(async () => {
          expect((await stat(join(cached.dir, "hello.ts"))).mode & 0o222).toBe(0);
          expect((await stat(cached.dir)).mode & 0o222).toBe(0);
          await chmod(cached.dir, 0o700);
          await unlink(join(cached.dir, "hello.ts"));
          await writeFile(join(outside, "kept.ts"), "do not change");
          await symlink(join(outside, "kept.ts"), join(cached.dir, "hello.ts"));
        });
        expect(
          Exit.isFailure(
            yield* Effect.exit(
              storage.tree({ kind: "extension", name: tree.name, files: tree.hash }),
            ),
          ),
        ).toBe(true);
        expect(yield* storage.cached({ kind: "extension", pin })).toBeNull();
        yield* storage.mutate((tx) => tx.store({ kind: "extension", pin }, tree));
        expect(
          (yield* storage.tree({ kind: "extension", name: tree.name, files: tree.hash }))?.dir,
        ).toBe(cached.dir);
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
              storage.mutate((tx) =>
                tx.update(root, scope, (held) => ({
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
            ),
            { concurrency: 2 },
          );
          expect(
            Object.keys((yield* storage.read(root, scope)).lock.extensions).toSorted(),
          ).toEqual(["one", "two"]);
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
          Exit.isFailure(
            yield* Effect.exit(storage.mutate((tx) => tx.update(root, "store", (held) => held))),
          ),
        ).toBe(true);
      }).pipe(Effect.provide(storageLayer)),
    );
    expect(await readFile(file, "utf8")).toBe(body);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function appeared(path: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!(await Bun.file(path).exists())) {
    if (Date.now() > deadline) throw new Error(`worker did not reach ${path}`);
    await Bun.sleep(10);
  }
}
test("one process holds publication and selection together against a second mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "kb-install-txn-"));
  const children: Bun.Subprocess[] = [];
  const spawn = (name: string) => {
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `
      import {Effect,Fiber} from "effect";
      import {Layer} from "effect";
      import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
      import {writeFileSync} from "node:fs";
      import {ExtensionStorage} from "@kb/contracts";
      import {checkedExtensionTree} from "@kb/extension-source";
      import {extensionStorageLayer} from "./src/index.ts";
      const storageLayer=extensionStorageLayer.pipe(Layer.provide(BunFileSystem.layer));
      const root=${JSON.stringify(root)};
      const name=${JSON.stringify(name)};
      const body=Effect.gen(function*(){
        const storage=yield* ExtensionStorage;
        const mutation=storage.mutate((tx)=>Effect.gen(function*(){
          yield* Effect.sync(()=>writeFileSync(root+"/entered-"+name,""));
          if(name==="b"){const plan=yield* tx.collection([root]);yield* plan.sweep;}
          const pin={repo:"owner/repo",path:name,rev:"a".repeat(40)};
          const source=yield* checkedExtensionTree([{path:name+".ts",mode:"100644",bytes:new TextEncoder().encode("export const value=42;")}]);
          const stored=yield* tx.store({kind:"extension",pin},source);
          yield* Effect.sync(()=>writeFileSync(root+"/published-"+name,""));
          if(name==="a") yield* Effect.gen(function*(){
            while(!(yield* Effect.promise(()=>Bun.file(root+"/release-a").exists()))) yield* Effect.sleep(10);
          }).pipe(Effect.timeout(5000));
          yield* tx.update(root,"store",held=>({...held,extensions:{...held.extensions,[name]:{original:"github:owner/repo/"+name,locked:{...pin,files:stored.files}}}}));
        }));
        const fiber=Effect.runFork(mutation);
        yield* Effect.sync(()=>writeFileSync(root+"/probed-"+name,""));
        yield* Fiber.join(fiber);
      });
      await Effect.runPromise(body.pipe(Effect.provide(storageLayer)));
    `,
      ],
      {
        cwd: join(import.meta.dir, ".."),
        env: { ...process.env },
        stdout: "ignore",
        stderr: "pipe",
      },
    );
    children.push(child);
  };
  try {
    spawn("a");
    await appeared(join(root, "published-a"));
    spawn("b");
    await appeared(join(root, "probed-b"));
    expect(await Bun.file(join(root, "entered-b")).exists()).toBe(false);
    await writeFile(join(root, "release-a"), "");
    for (const child of children) expect(await child.exited).toBe(0);
    const lock = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* ExtensionStorage).read(root, "store");
      }).pipe(Effect.provide(storageLayer)),
    );
    expect(Object.keys(lock.lock.extensions)).toEqual(["a", "b"]);
  } finally {
    for (const child of children) child.kill();
    await Promise.allSettled(children.map((child) => child.exited));
    await rm(root, { recursive: true, force: true });
  }
});

test("cache selectors distinguish two product projections of the same pinned source", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const storage = yield* ExtensionStorage;
      const raw = yield* checkedTree([
        {
          path: "hello.ts",
          mode: "100644",
          bytes: new TextEncoder().encode("export const value=42;"),
        },
        { path: "kb-marketplace.json", mode: "100644", bytes: new TextEncoder().encode("{}") },
      ]);
      const extension = yield* extensionTree(raw);
      const index = yield* checkedTree(
        raw.files.filter(({ path }) => path === "kb-marketplace.json"),
      );
      const marketplace = { ...index, name: "sample", ignored: ["hello.ts"] };
      const [one, two] = yield* storage.mutate((tx) =>
        Effect.all(
          [
            tx.store({ kind: "extension", pin }, extension),
            tx.store({ kind: "marketplace", pin }, marketplace),
          ],
          { concurrency: 2 },
        ),
      );
      expect(one.files).not.toBe(two.files);
      expect(two.dir).toEndWith("-sample.marketplace");
      expect((yield* storage.cached({ kind: "extension", pin }))?.files).toBe(one.files);
      expect((yield* storage.cached({ kind: "marketplace", pin }))?.files).toBe(two.files);
      expect(two.source.files.map(({ path }) => path)).toEqual(["kb-marketplace.json"]);
    }).pipe(Effect.provide(storageLayer)),
  );
});
test("opening installation state preserves lock bytes and creates no cache or mutation lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "kb-install-read-"));
  try {
    await mkdir(join(root, ".kb"));
    const file = join(root, ".kb", "extensions.lock.json");
    const bytes = ' { "version":1, "extensions":{}, "marketplaces":{}, "links":[] }\n\n';
    await writeFile(file, bytes);
    const data = await Effect.runPromise(currentData);
    await Effect.runPromise(
      Effect.gen(function* () {
        const storage = yield* ExtensionStorage;
        for (const scope of ["store", "local", "user"] as const) yield* storage.read(root, scope);
        expect(yield* storage.cached({ kind: "extension", pin })).toBeNull();
        expect(
          yield* storage.tree({
            kind: "extension",
            name: "hello",
            files: `sha256:${"a".repeat(64)}`,
          }),
        ).toBeNull();
      }).pipe(Effect.provide(storageLayer)),
    );
    expect(await readFile(file, "utf8")).toBe(bytes);
    const directory = await stat(join(data, "extensions")).catch((error: unknown) => error);
    expect(directory).toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the pin index is versioned and an unknown version is a read-only cache miss", async () => {
  const tree = await source();
  await Effect.runPromise(
    Effect.gen(function* () {
      const storage = yield* ExtensionStorage;
      yield* storage.mutate((tx) => tx.store({ kind: "extension", pin }, tree));
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
      expect(yield* storage.cached({ kind: "extension", pin })).toBeNull();
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
          const read = yield* storage.read(root, "store");
          expect(read.lock.links).toEqual([]);
          expect(read.failures).toHaveLength(1);
          expect(
            Exit.isFailure(
              yield* Effect.exit(storage.mutate((tx) => tx.update(root, "store", (held) => held))),
            ),
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
        expect((yield* storage.read(root, "store")).lock.links).toEqual([
          "alias",
          "inside/missing",
        ]);
        for (const scope of ["local", "user"] as const) {
          yield* storage.mutate((tx) =>
            tx.update(root, scope, (held) => ({ ...held, links: [sibling] })),
          );
          expect((yield* storage.read(root, scope)).lock.links).toEqual([sibling]);
        }
      }).pipe(Effect.provide(storageLayer)),
    );
  } finally {
    await rm(at, { recursive: true, force: true });
  }
});
