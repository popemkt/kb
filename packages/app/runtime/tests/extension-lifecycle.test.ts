import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, readFile, readdir, mkdir, writeFile, symlink } from "node:fs/promises";
import { childProcessEnv } from "@kb/child-process";
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
let metadataRefs: Map<string, string>;
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
  metadataRefs = new Map([
    ["HEAD", sha(4)],
    ["refs/heads/main", sha(4)],
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
        "owner/metadata",
        {
          refs: metadataRefs,
          revisions: new Map(
            [4, 5, 6].map((n) => [
              sha(n),
              [...repository(1), file("extensions/hello/README.md", `synthetic readme ${n}`)],
            ]),
          ),
          parents: new Map([
            [sha(5), [sha(4)]],
            [sha(6), [sha(5)]],
          ]),
        },
      ],
      [
        "owner/imposter",
        {
          refs: new Map([
            ["HEAD", sha(3)],
            ["refs/heads/main", sha(3)],
          ]),
          revisions: new Map([[sha(3), repository(1)]]),
          parents: new Map(),
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

test("gc retains an unregistered existing root's private install and reports orphan trust retirement", async () => {
  await call("extension.install", {
    source: "github:owner/repo/extensions/hello@main",
    scope: "local",
  });
  const row = await trust("hello");
  const b = await openKb(join(root, "b"));
  const data = await Effect.runPromise(currentData);
  const ledger = join(data, "trust.json");
  const bytes = await readFile(ledger, "utf8");
  const tree = join(data, "extensions", "store", `${row.files?.slice(7, 39)}-hello`);
  expect(await call("extension.gc", {}, b)).toMatchObject({ retiredTrust: [], trees: [] });
  expect(await Bun.file(join(tree, "hello.ts")).exists()).toBe(true);
  expect(await readFile(ledger, "utf8")).toBe(bytes);
  await rm(ctx.root, { recursive: true, force: true });
  const collected = await call("extension.gc", {}, b);
  expect(collected).toMatchObject({
    retiredTrust: [{ digest: row.digest, name: "hello", files: row.files }],
    orphanedLocalLocks: [expect.objectContaining({ root: ctx.root })],
  });
  expect(await Bun.file(join(tree, "hello.ts")).exists()).toBe(false);
});
test("a committed marketplace cannot hide a private user marketplace with the same name", async () => {
  await call("extension.marketplace.add", { source: "github:owner/imposter@main" });
  const hostile = await readFile(join(ctx.root, ".kb", "extensions.lock.json"), "utf8");
  await call("extension.marketplace.remove", { name: "sample" });
  await call("extension.marketplace.add", { source: "github:owner/repo@main", scope: "user" });
  await writeFile(join(ctx.root, ".kb", "extensions.lock.json"), hostile);
  const clone = join(root, "clone");
  for (const args of [
    ["init", "--quiet"],
    ["add", ".kb/extensions.lock.json"],
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "Synthetic marketplace collision",
    ],
    ["clone", "--quiet", ctx.root, clone],
  ]) {
    const git = Bun.spawnSync(["git", "-c", "core.hooksPath=/dev/null", ...args], {
      cwd: ctx.root,
      env: childProcessEnv("git"),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(git.exitCode, git.stderr.toString()).toBe(0);
  }
  const cloned = await openKb(clone);
  for (const source of ["hello@sample", "hello"]) {
    const result = await request("extension.install", { source }, cloned);
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.message).toContain("ambiguous marketplace sample");
      expect(result.message).toContain("store: owner/imposter");
      expect(result.message).toContain("user: owner/repo");
    }
  }
});
test("adding a different repository over a marketplace name requires explicit replace", async () => {
  await call("extension.marketplace.add", { source: "github:owner/repo@main" });
  const before = await readFile(join(ctx.root, ".kb", "extensions.lock.json"), "utf8");
  expect(
    await request("extension.marketplace.add", { source: "github:owner/imposter@main" }),
  ).toMatchObject({ status: "failed", message: expect.stringContaining("--replace") });
  expect(await readFile(join(ctx.root, ".kb", "extensions.lock.json"), "utf8")).toBe(before);
  expect(
    await call("extension.marketplace.add", {
      source: "github:owner/imposter@main",
      replace: true,
    }),
  ).toMatchObject({ selection: { locked: { repo: "owner/imposter" } } });
  const installed = await call("extension.install", { source: "hello@sample" });
  expect(installed).toMatchObject({
    installed: [{ marketplace: { name: "sample", repo: "owner/imposter", scope: "store" } }],
  });
});
test("fetching an update never holds the mutation lock and a concurrent selection change conflicts", async () => {
  await call("extension.install", {
    source: "github:owner/repo/extensions/hello@main",
    scope: "local",
  });
  const b = await openKb(join(root, "b"));
  advance();
  const base = reader;
  const started = Promise.withResolvers<void>();
  const waiting = Promise.withResolvers<void>();
  reader = {
    resolve: base.resolve,
    read: Effect.fn("fixture.blockedFetch")(function* (pin) {
      if (pin.rev === sha(2) && pin.path === "extensions/hello") {
        started.resolve();
        yield* Effect.promise(() => waiting.promise);
      }
      return yield* base.read(pin);
    }),
  };
  const updating = request("extension.update");
  try {
    await started.promise;
    await Promise.race([
      call(
        "extension.install",
        { source: "github:owner/repo/extensions/aurora@main", scope: "local" },
        b,
      ),
      Bun.sleep(3000).then(() => {
        throw new Error("network fetch held the global mutation lock");
      }),
    ]);
    await call("extension.remove", { name: "hello", scope: "local" });
    waiting.resolve();
    expect(await updating).toMatchObject({ status: "failed", code: "conflict" });
    resetRegistryCache();
    expect((await listing()).some((row) => row.name === "hello")).toBe(false);
  } finally {
    waiting.resolve();
    await updating;
  }
});

test("successive README-only updates keep the shared executable approval and a usable diff baseline", async () => {
  await call("extension.install", {
    source: "github:owner/metadata/extensions/hello@main",
    scope: "local",
  });
  const approved = await trust("hello");
  const digest = approved.digest ?? "";
  for (const revision of [5, 6]) {
    metadataRefs.set("HEAD", sha(revision));
    metadataRefs.set("refs/heads/main", sha(revision));
    const update = await call("extension.update", { name: "hello", scope: "local" });
    expect(update).toMatchObject({ updated: [{ digest, trusted: true }] });
    await call("extension.gc");
    expect(
      await Effect.runPromise(
        Effect.gen(function* () {
          return yield* (yield* CodeTrust).trusted([digest]);
        }).pipe(Effect.provide(codeTrustLayer().pipe(Layer.provide(bunFileSystemLayer)))),
      ),
    ).toEqual([digest]);
  }
  resetRegistryCache();
  expect(await call("extension.diff", { name: "hello" })).toMatchObject({ files: [] });
});
