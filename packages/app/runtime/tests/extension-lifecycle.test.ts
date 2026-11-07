import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, readFile, readdir, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { CodeTrust, ExtensionReportSchema, type KbContext } from "@kb/contracts";
import { SourceReader, type ObjectFile } from "@kb/extension-source";
import { memorySourceReader } from "@kb/source-git";
import { extensionModule, pointHomeAt, writeTrustedExtension } from "@kb/test-kit";
import { currentData, codeTrustLayer } from "@kb/workspace-fs";
import { extensionUpdateDef, extensionOutdatedDef, extensionDiffDef } from "@kb/operations";
import { openKb } from "../src/session.ts";
import { invoke } from "../src/invoke.ts";
import { invokeReceiptEffect, resetRegistryCache } from "../src/registry.ts";
import { kbRuntimeLayer } from "../src/layers.ts";
import { bunFileSystemLayer } from "../src/platform.ts";
import { createStore, STORE_BACKENDS } from "../src/store-selection.ts";

let root: string;
let ctx: KbContext;
let reader: SourceReader["Service"];
let refs: Map<string, string>;
let reads: number;
let restoreHome: () => void;
const sha = (n: number) => String(n).repeat(40);
const file = (path: string, text: string): ObjectFile => ({
  path,
  mode: "100644",
  bytes: new TextEncoder().encode(text),
});
function repository(version: number, indexName = "sample"): ObjectFile[] {
  return [
    file(
      "kb-marketplace.json",
      JSON.stringify({
        version: 1,
        name: indexName,
        extensions: [
          { name: "hello", source: { path: "extensions/hello" } },
          { name: "aurora", source: { path: "extensions/aurora" } },
        ],
      }),
    ),
    ...(["hello", "aurora"] as const).map((name) =>
      file(
        `extensions/${name}/${name}.ts`,
        extensionModule(name, {
          declaration: `{name:${JSON.stringify(name)},label:${JSON.stringify(name)},seed:at=>[{id:${JSON.stringify(`${name}.sample`)},text:"synthetic seed",props:{},children:[],createdAt:at,updatedAt:at}]}`,
          actions: `[{id:"version",title:"Version",description:"Synthetic version",mode:{kind:"read"},inputSchema:{parse:x=>x},outputSchema:{parse:x=>x},handler:async()=>({version:${version}})}]`,
        }),
      ),
    ),
  ];
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kb-lifecycle-"));
  restoreHome = pointHomeAt(join(root, "home"));
  ctx = await openKb(join(root, "a"));
  reads = 0;
  refs = new Map([
    ["HEAD", sha(1)],
    ["refs/heads/main", sha(1)],
    ["refs/tags/one", sha(1)],
    ["refs/tags/two", sha(2)],
  ]);
  const base = memorySourceReader(
    new Map([
      [
        "owner/repo",
        {
          refs,
          revisions: new Map([
            [sha(1), repository(1)],
            [sha(2), repository(2)],
          ]),
          parents: new Map([[sha(2), [sha(1)]]]),
        },
      ],
      [
        "owner/other",
        {
          refs: new Map([
            ["HEAD", sha(3)],
            ["refs/heads/main", sha(3)],
          ]),
          revisions: new Map([[sha(3), repository(1, "other")]]),
          parents: new Map(),
        },
      ],
    ]),
  );
  reader = {
    resolve: base.resolve,
    read: Effect.fn("fixture.lifecycle.read")(function* (pin) {
      reads++;
      return yield* base.read(pin);
    }),
  };
});
afterEach(async () => {
  restoreHome();
  resetRegistryCache();
  await rm(root, { recursive: true, force: true });
});
function request(id: string, input: unknown = {}, on = ctx) {
  return Effect.runPromise(
    invokeReceiptEffect(on, { id, input, actor: "agent" }).pipe(
      Effect.provide(Layer.merge(kbRuntimeLayer(on), Layer.succeed(SourceReader, reader))),
    ),
  );
}
async function call(id: string, input: unknown = {}, on = ctx) {
  const receipt = await request(id, input, on);
  if (receipt.status !== "succeeded") throw new Error(`${id}: ${JSON.stringify(receipt)}`);
  return receipt.output;
}
async function listing(on = ctx) {
  return ExtensionReportSchema.parse(await call("extension.list", {}, on)).extensions;
}
async function trust(name: string, on = ctx) {
  resetRegistryCache();
  const row = (await listing(on)).find(
    (candidate) => candidate.name === name && candidate.shadowed === undefined,
  );
  if (row?.digest === undefined || row.files === undefined)
    throw new Error("missing source review");
  expect(
    await invoke(on, {
      id: "sandbox.trust",
      input: { digest: row.digest, extension: { name, files: row.files } },
      approved: true,
    }),
  ).toMatchObject({ status: "succeeded" });
  return row;
}
function advance() {
  refs.set("refs/heads/main", sha(2));
  refs.set("HEAD", sha(2));
}
async function lock(on = ctx) {
  return JSON.parse(await readFile(join(on.root, ".kb", "extensions.lock.json"), "utf8"));
}

test("marketplace installs are self-contained and a cached second store adds no download", async () => {
  await call("extension.marketplace.add", { source: "github:owner/repo@main" });
  await call("extension.install", { source: "hello" });
  expect((await lock()).extensions.hello.original).toBe("hello@sample");
  expect((await lock()).marketplaces.sample.locked.rev).toBe(sha(1));
  const old = await trust("hello");
  const b = await openKb(join(root, "b"));
  const before = reads;
  await call("extension.install", { source: "hello@sample", scope: "user" });
  await call("extension.install", { source: "github:owner/repo/extensions/hello@main" }, b);
  expect(reads).toBe(before);
  resetRegistryCache();
  expect(
    (await listing(b)).find((row) => row.name === "hello" && row.shadowed === undefined),
  ).toMatchObject({ digest: old.digest, trusted: true });
  const c = await openKb(join(root, "c"));
  expect((await listing(c)).find((row) => row.name === "hello")).toMatchObject({
    digest: old.digest,
    trusted: true,
  });
});
test("a bare name offered by two indexes is refused with qualified alternatives", async () => {
  await call("extension.marketplace.add", { source: "github:owner/repo@main" });
  await call("extension.marketplace.add", { source: "github:owner/other@main" });
  expect(await request("extension.install", { source: "hello" })).toMatchObject({
    status: "failed",
    message: expect.stringContaining("hello@other, hello@sample"),
  });
  await call("extension.install", { source: "hello@other" });
  expect((await lock()).extensions.hello.original).toBe("hello@other");
});
test("outdated is read-only; update refreshes the index and keeps approved bytes running until approval", async () => {
  await call("extension.marketplace.add", { source: "github:owner/repo@main" });
  await call("extension.install", { source: "hello" });
  const old = await trust("hello");
  ctx = await openKb(ctx.root);
  expect(await call("ext.hello.version")).toEqual({ version: 1 });
  const oldLock = await readFile(join(ctx.root, ".kb", "extensions.lock.json"), "utf8");
  const data = await Effect.runPromise(currentData);
  const trustBytes = await readFile(join(data, "trust.json"), "utf8");
  const storeBefore = await readdir(join(data, "extensions", "store"));
  advance();
  const outdated = extensionOutdatedDef.outputSchema.parse(await call("extension.outdated"));
  expect(outdated.extensions).toMatchObject([
    { name: "hello", from: sha(1), to: sha(2), files: ["hello.ts"] },
  ]);
  expect(await readFile(join(ctx.root, ".kb", "extensions.lock.json"), "utf8")).toBe(oldLock);
  expect(await readFile(join(data, "trust.json"), "utf8")).toBe(trustBytes);
  expect(await readdir(join(data, "extensions", "store"))).toEqual(storeBefore);
  const updated = extensionUpdateDef.outputSchema.parse(await call("extension.update"));
  expect(updated.updated).toMatchObject([
    { name: "hello", from: sha(1), to: sha(2), trusted: false },
  ]);
  expect((await lock()).marketplaces.sample.locked.rev).toBe(sha(2));
  expect((await lock()).extensions.hello.previous.files).toBe(old.files);
  resetRegistryCache();
  ctx = await openKb(ctx.root);
  const pending = (await listing()).find((row) => row.name === "hello");
  expect(pending).toMatchObject({ trusted: false, running: { digest: old.digest }, enabled: true });
  expect(await call("ext.hello.version")).toEqual({ version: 1 });
  expect(
    extensionDiffDef.outputSchema.parse(await call("extension.diff", { name: "hello" })).files[0]
      ?.to,
  ).toContain("version:2");
  const current = await trust("hello");
  expect(current.digest).not.toBe(old.digest);
  expect(await call("ext.hello.version")).toEqual({ version: 2 });
  await writeFile(join(ctx.root, ".kb", "extensions.lock.json"), oldLock);
  resetRegistryCache();
  ctx = await openKb(ctx.root);
  expect(await call("ext.hello.version")).toEqual({ version: 1 });
});
test("links preserve scope policy, shared trust, edited untrusted bytes, and missing-folder failures", async () => {
  const folder = join(root, "development");
  await writeTrustedExtension(folder, "linked.ts", extensionModule("linked"));
  const path = join(folder, ".kb", "extensions");
  expect(await request("extension.link", { path })).toMatchObject({
    status: "failed",
    code: "invalid_input",
  });
  const linked = await call("extension.link", { path, scope: "local" });
  expect(linked).toMatchObject({ notice: expect.stringContaining("already trusted") });
  resetRegistryCache();
  expect((await listing()).find((row) => row.name === "linked")).toMatchObject({
    trusted: true,
    enabled: true,
    origin: { kind: "link", scope: "local" },
  });
  await writeFile(
    join(path, "linked.ts"),
    extensionModule("linked", { prelude: "export const changed=true;" }),
  );
  resetRegistryCache();
  expect((await listing()).find((row) => row.name === "linked")).toMatchObject({
    trusted: false,
    enabled: false,
  });
  await rm(path, { recursive: true, force: true });
  resetRegistryCache();
  expect(await call("extension.list")).toMatchObject({
    failures: expect.arrayContaining([
      expect.objectContaining({ file: path, error: "linked extension folder is missing" }),
    ]),
  });
  await call("extension.unlink", { path, scope: "local" });
});
for (const backend of STORE_BACKENDS)
  test(`gc respects registered locks in a ${backend} home, user locks and provenance`, async () => {
    await mkdir(join(root, "home"));
    await Effect.runPromise(
      createStore(join(root, "home"), backend).pipe(Effect.provide(bunFileSystemLayer)),
    );
    await call("extension.install", { source: "github:owner/repo/extensions/hello@main" });
    const old = await trust("hello");
    ctx = await openKb(ctx.root);
    expect(ctx.nodes.some((node) => node.id === "hello.sample")).toBe(true);
    const b = await openKb(join(root, "b"));
    await call("extension.install", { source: "github:owner/repo/extensions/hello@main" }, b);
    await call("location.register", { path: b.root });
    await call("extension.install", {
      source: "github:owner/repo/extensions/aurora@main",
      scope: "user",
    });
    const bare = `sha256:${"e".repeat(64)}`;
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* (yield* CodeTrust).trust(bare);
      }).pipe(Effect.provide(codeTrustLayer().pipe(Layer.provide(bunFileSystemLayer)))),
    );
    await call("extension.remove", { name: "hello" });
    await call("extension.gc");
    const data = await Effect.runPromise(currentData);
    const tree = join(data, "extensions", "store", `${old.files?.slice(7, 39)}-hello`);
    expect(await Bun.file(join(tree, "hello.ts")).exists()).toBe(true);
    await call("extension.remove", { name: "hello" }, b);
    const stage = join(data, "extensions", "tmp", "tree-abandoned");
    await mkdir(stage, { recursive: true });
    const outside = join(root, "outside");
    await writeFile(outside, "keep");
    await symlink(outside, join(stage, "link"));
    await call("extension.gc");
    expect(await Bun.file(join(tree, "hello.ts")).exists()).toBe(false);
    expect(await readFile(outside, "utf8")).toBe("keep");
    expect(await readdir(join(data, "extensions", "tmp"))).not.toContain("tree-abandoned");
    const digests = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* CodeTrust).trusted([old.digest ?? "", bare]);
      }).pipe(Effect.provide(codeTrustLayer().pipe(Layer.provide(bunFileSystemLayer)))),
    );
    expect(digests).toEqual([bare]);
    expect(
      (await readdir(join(data, "extensions", "store"))).some((name) => name.endsWith("-aurora")),
    ).toBe(true);
    ctx = await openKb(ctx.root);
    expect(ctx.nodes.some((node) => node.id === "hello.sample")).toBe(true);
  });

test("collection refuses unreadable locks or trust before deleting any source", async () => {
  await call("extension.install", { source: "github:owner/repo/extensions/hello@main" });
  await call("extension.remove", { name: "hello" });
  const data = await Effect.runPromise(currentData);
  const before = await readdir(join(data, "extensions", "store"));
  const lockFile = join(ctx.root, ".kb", "extensions.lock.json");
  const bytes = await readFile(lockFile, "utf8");
  await writeFile(lockFile, '{"version":2}');
  expect(await request("extension.gc")).toMatchObject({ status: "failed" });
  expect(await readdir(join(data, "extensions", "store"))).toEqual(before);
  await writeFile(lockFile, bytes);
  const trustFile = join(data, "trust.json");
  await writeFile(trustFile, '{"version":2,"trusted":[]}');
  expect(await request("extension.gc")).toMatchObject({ status: "failed" });
  expect(await readFile(trustFile, "utf8")).toBe('{"version":2,"trusted":[]}');
  expect(await readdir(join(data, "extensions", "store"))).toEqual(before);
});
