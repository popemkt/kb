import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { SourceReader, type ObjectFile, type PinnedSource } from "@kb/extension-source";
import { memorySourceReader } from "@kb/source-git";
import { currentData } from "@kb/workspace-fs";
import { extensionInstallDef } from "@kb/operations";
import { extensionModule, writeTrustedExtension } from "@kb/test-kit";
import { kbRuntimeLayer } from "../src/layers.ts";
import { openKb } from "../src/session.ts";
import { invokeReceiptEffect, admitExtensions, resetRegistryCache } from "../src/registry.ts";
import { invoke } from "../src/invoke.ts";
import { bunFileSystemLayer } from "../src/platform.ts";

let root: string;
let ctx: Awaited<ReturnType<typeof openKb>>;
let reader: SourceReader["Service"];
let reads: number;
let data: string;
const ref = (n: number) => n.toString(16).repeat(40);
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kb-installs-"));
  data = await Effect.runPromise(currentData);
  ctx = await openKb(join(root, "a"));
  reads = 0;
  const files = new Map<string, readonly ObjectFile[]>();
  for (const [name, n, prelude] of [
    [
      "hello",
      1,
      `import {writeFileSync} from "node:fs";writeFileSync(${JSON.stringify(join(root, "ran"))},"ran");`,
    ],
    ["bomb", 2, "process.exit(41);"],
    ["graph", 3, ""],
    ["escape", 4, 'import { value } from "../outside.ts"; void value;'],
  ] as const) {
    files.set(ref(n), [
      {
        path: `${name}.ts`,
        mode: "100644",
        bytes: new TextEncoder().encode(extensionModule(name, { prelude })),
      },
    ]);
  }
  files.set(ref(6), [
    {
      path: "hello.ts",
      mode: "100644",
      bytes: new TextEncoder().encode(
        extensionModule("hello", { prelude: "export const version=2;" }),
      ),
    },
  ]);
  const base = memorySourceReader(
    new Map([
      [
        "owner/repo",
        {
          revisions: files,
          parents: new Map(),
          refs: new Map([
            ["refs/heads/main", ref(1)],
            ["refs/heads/bomb", ref(2)],
            ["refs/heads/graph", ref(3)],
            ["refs/heads/escape", ref(4)],
            ["refs/heads/near", ref(6)],
          ]),
        },
      ],
    ]),
  );
  reader = {
    resolve: base.resolve,
    read: Effect.fn("fixture.read")(function* (pin: PinnedSource) {
      reads++;
      return yield* base.read(pin);
    }),
  };
});
afterEach(async () => {
  resetRegistryCache();
  await rm(root, { recursive: true, force: true });
});
async function install(
  input: { source?: string; scope?: "store" | "local" | "user" } = {},
  on = ctx,
) {
  const receipt = await Effect.runPromise(
    invokeReceiptEffect(on, { id: "extension.install", input, actor: "agent" }).pipe(
      Effect.provide(Layer.merge(kbRuntimeLayer(on), Layer.succeed(SourceReader, reader))),
    ),
  );
  return receipt;
}
function successful(receipt: Awaited<ReturnType<typeof install>>) {
  expect(receipt.status).toBe("succeeded");
  return extensionInstallDef.outputSchema.parse(
    receipt.status === "succeeded" ? receipt.output : null,
  );
}
test("install pins without running or trusting and a second store uses the cached copy", async () => {
  const first = successful(await install({ source: "github:owner/repo@main" }));
  const row = first.installed[0];
  if (row === undefined) throw new Error("missing installed row");
  expect(row).toMatchObject({
    name: "hello",
    rev: ref(1),
    trusted: false,
    cached: false,
  });
  expect(reads).toBe(1);
  expect(await Bun.file(join(root, "ran")).exists()).toBe(false);
  const second = await openKb(join(root, "b"));
  expect(
    successful(await install({ source: "github:owner/repo@main" }, second)).installed[0],
  ).toMatchObject({ cached: true, trusted: false });
  expect(reads).toBe(1);
  const lock = JSON.parse(
    await readFile(join(ctx.root, ".kb", "extensions.lock.json"), "utf8"),
  ) as { extensions: { hello: { locked: { rev: string; files: string } } } };
  expect(lock.extensions.hello.locked.rev).toBe(ref(1));
  expect(lock.extensions.hello.locked.files).toBe(row.files);
  resetRegistryCache();
  expect(await invoke(ctx, { id: "extension.list", input: {} })).toMatchObject({
    status: "succeeded",
    output: { failures: [{ file: "hello.ts", error: expect.stringContaining("not trusted") }] },
  });
  expect(await Bun.file(join(root, "ran")).exists()).toBe(false);
});
test("tampering is refused and source-less install repairs it at the pinned revision", async () => {
  const first = successful(await install({ source: "github:owner/repo@main" })).installed[0];
  if (first === undefined) throw new Error("missing installed row");
  const dir = join(data, "extensions", "store", `${first.files.slice(7, 39)}-hello`);
  await chmod(join(dir, "hello.ts"), 0o600);
  await writeFile(join(dir, "hello.ts"), "changed");
  resetRegistryCache();
  expect(await invoke(ctx, { id: "extension.list", input: {} })).toMatchObject({
    status: "succeeded",
    output: { failures: [{ error: expect.stringContaining("tampered") }] },
  });
  expect(successful(await install()).installed[0]).toMatchObject({
    files: first.files,
    rev: ref(1),
  });
  expect(reads).toBe(2);
  expect(await Bun.file(join(root, "ran")).exists()).toBe(false);
});
test("missing trees are reported and restored without changing the lock", async () => {
  const first = successful(await install({ source: "github:owner/repo@main" })).installed[0];
  if (first === undefined) throw new Error("missing installed row");
  const file = join(ctx.root, ".kb", "extensions.lock.json");
  const before = await readFile(file, "utf8");
  const dir = join(data, "extensions", "store", `${first.files.slice(7, 39)}-hello`);
  await chmod(dir, 0o700);
  await rm(dir, { recursive: true });
  resetRegistryCache();
  expect(await invoke(ctx, { id: "extension.list", input: {} })).toMatchObject({
    status: "succeeded",
    output: { failures: [{ error: expect.stringContaining("not fetched") }] },
  });
  successful(await install());
  expect(await readFile(file, "utf8")).toBe(before);
  expect(reads).toBe(2);
});
test("bundled names and escaping imports never enter a lock", async () => {
  expect(await install({ source: "github:owner/repo@graph" })).toMatchObject({
    status: "failed",
    code: "invalid_input",
    message: expect.stringContaining("bundled"),
  });
  await mkdir(join(data, "extensions", "store"), { recursive: true });
  await writeFile(join(data, "extensions", "store", "outside.ts"), "export const value = 42;");
  expect(await install({ source: "github:owner/repo@escape" })).toMatchObject({
    status: "failed",
    code: "invalid_input",
    message: expect.stringContaining("escapes"),
  });
  expect(await Bun.file(join(ctx.root, ".kb", "extensions.lock.json")).exists()).toBe(false);
});
test("admission checks locks without importing an installed process.exit module", async () => {
  successful(await install({ source: "github:owner/repo@bomb" }));
  expect(
    await Effect.runPromise(admitExtensions(ctx.root).pipe(Effect.provide(bunFileSystemLayer))),
  ).toEqual([]);
  const file = join(ctx.root, ".kb", "extensions.lock.json");
  const lock = JSON.parse(await readFile(file, "utf8")) as { links: string[] };
  lock.links = ["/absolute/store/link"];
  await writeFile(file, JSON.stringify(lock));
  expect(
    await Effect.runPromise(admitExtensions(ctx.root).pipe(Effect.provide(bunFileSystemLayer))),
  ).toEqual([
    {
      file: "/absolute/store/link",
      error: expect.stringContaining("relative and resolve inside"),
    },
  ]);
});

test("user selections appear in a fresh store without installing there", async () => {
  successful(await install({ source: "github:owner/repo@main", scope: "user" }));
  const fresh = await openKb(join(root, "c"));
  expect(await invoke(fresh, { id: "extension.list", input: {} })).toMatchObject({
    status: "succeeded",
    output: { failures: [{ file: "hello.ts", error: expect.stringContaining("not trusted") }] },
  });
  expect(await Bun.file(join(ctx.root, ".kb", "extensions.lock.json")).exists()).toBe(false);
  expect(reads).toBe(1);
});
test("local installations shadow store installations before trust", async () => {
  successful(await install({ source: "github:owner/repo@main", scope: "store" }));
  const near = successful(await install({ source: "github:owner/repo@near", scope: "local" }))
    .installed[0];
  if (near === undefined) throw new Error("missing local installation");
  resetRegistryCache();
  const listed = await invoke(ctx, { id: "extension.list", input: {} });
  expect(JSON.stringify(listed)).toContain("shadowed");
  expect(JSON.stringify(listed)).toContain(near.digest);
});

test("restore checks the lock identity before publishing a source or pin index", async () => {
  const lock = {
    version: 1,
    extensions: {
      hello: {
        original: "github:owner/repo@main",
        locked: { repo: "owner/repo", path: "", rev: ref(1), files: `sha256:${"f".repeat(64)}` },
      },
    },
    marketplaces: {},
    links: [],
  };
  const file = join(ctx.root, ".kb", "extensions.lock.json");
  await writeFile(file, JSON.stringify(lock));
  expect(await install()).toMatchObject({
    status: "failed",
    code: "invalid_input",
    message: expect.stringContaining("does not match expected"),
  });
  const index = await stat(join(data, "extensions", "refs")).catch((error: unknown) => error);
  expect(index).toMatchObject({ code: "ENOENT" });
  const store = await stat(join(data, "extensions", "store")).catch((error: unknown) => error);
  expect(store).toMatchObject({ code: "ENOENT" });
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual(lock);
});
test("a hostile committed store lock cannot select a sibling's trusted extension", async () => {
  const sibling = join(root, "sibling");
  const marker = join(root, "sibling-ran");
  await writeTrustedExtension(
    sibling,
    "borrowed.ts",
    extensionModule("borrowed", {
      prelude: `import {writeFileSync} from "node:fs";writeFileSync(${JSON.stringify(marker)},"ran");`,
    }),
  );
  const clone = await openKb(join(root, "clone"));
  const file = join(clone.root, ".kb", "extensions.lock.json");
  await symlink(join(sibling, ".kb", "extensions"), join(clone.root, "alias"));
  await writeTrustedExtension(join(clone.root, "inside"), "good.ts", extensionModule("good"));
  const installed = successful(await install({ source: "github:owner/repo@main" }, clone));
  const originalLock = JSON.parse(await readFile(file, "utf8"));
  for (const path of ["../sibling/.kb/extensions", "alias"]) {
    await writeFile(
      file,
      JSON.stringify({ ...originalLock, links: [path, "inside/.kb/extensions"] }),
    );
    resetRegistryCache();
    const receipt = await invoke(clone, { id: "extension.list", input: {} });
    expect(JSON.stringify(receipt)).toContain("relative and resolve inside");
    expect(receipt).toMatchObject({
      status: "succeeded",
      output: { extensions: expect.arrayContaining([expect.objectContaining({ name: "good" })]) },
    });
    expect(JSON.stringify(receipt)).toContain(installed.installed[0]?.digest ?? "missing digest");
    expect(await Bun.file(marker).exists()).toBe(false);
  }
  await writeFile(
    file,
    JSON.stringify({ version: 1, extensions: {}, marketplaces: {}, links: [] }),
  );
  expect(
    await invoke(clone, {
      id: "extension.link",
      input: { path: join(sibling, ".kb", "extensions"), scope: "local" },
    }),
  ).toMatchObject({ status: "succeeded" });
  resetRegistryCache();
  expect(await invoke(clone, { id: "extension.list", input: {} })).toMatchObject({
    status: "succeeded",
    output: { extensions: expect.arrayContaining([expect.objectContaining({ name: "borrowed" })]) },
  });
  expect(await Bun.file(marker).exists()).toBe(true);
});
