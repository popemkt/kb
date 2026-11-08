import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { CodeTrust, ExtensionReportSchema, ExtensionStorage } from "@kb/contracts";
import { SourceReader, type ObjectFile } from "@kb/extension-source";
import { memorySourceReader } from "@kb/source-git";
import { extensionModule } from "@kb/test-kit";
import { codeTrustLayer } from "@kb/workspace-fs";
import { openKb } from "../src/session.ts";
import { invoke } from "../src/invoke.ts";
import { invokeReceiptEffect, resetRegistryCache } from "../src/registry.ts";
import { kbRuntimeLayer } from "../src/layers.ts";
import { bunFileSystemLayer } from "../src/platform.ts";

let root: string;
let ctx: Awaited<ReturnType<typeof openKb>>;
const sha = (n: number) => String(n).repeat(40);
let reader: SourceReader["Service"];
const files = (version: number): ObjectFile[] => [
  {
    path: "hello.ts",
    mode: "100644",
    bytes: new TextEncoder().encode(
      extensionModule("hello", {
        prelude: `import {readFileSync} from "node:fs";export const version=${version};export const read=readFileSync;`,
      }),
    ),
  },
  {
    path: "hello.page.ts",
    mode: "100644",
    bytes: new TextEncoder().encode(
      'import React from "react";export const page=React.createElement("span",null,"hello");',
    ),
  },
];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kb-review-"));
  ctx = await openKb(join(root, "a"));
  reader = memorySourceReader(
    new Map([
      [
        "owner/repo",
        {
          revisions: new Map([
            [sha(1), files(1)],
            [sha(2), files(2)],
          ]),
          refs: new Map([
            ["refs/heads/one", sha(1)],
            ["refs/heads/two", sha(2)],
          ]),
          parents: new Map(),
        },
      ],
    ]),
  );
});
afterEach(async () => {
  resetRegistryCache();
  await rm(root, { recursive: true, force: true });
});
async function install(ref: string, scope: "store" | "local" = "store") {
  const result = await Effect.runPromise(
    invokeReceiptEffect(ctx, {
      id: "extension.install",
      input: { source: `github:owner/repo@${ref}`, scope },
      actor: "agent",
    }).pipe(Effect.provide(Layer.merge(kbRuntimeLayer(ctx), Layer.succeed(SourceReader, reader)))),
  );
  expect(result.status).toBe("succeeded");
  resetRegistryCache();
}
async function rows() {
  const result = await invoke(ctx, { id: "extension.list", input: {} });
  expect(result.status).toBe("succeeded");
  return ExtensionReportSchema.parse(
    result.status === "succeeded" ? result.output : null,
  ).extensions.filter((row) => row.name === "hello");
}
test("untrusted and shadowed copies share the catalog; reach discloses each half without import", async () => {
  await install("one");
  await install("two", "local");
  const listed = await rows();
  expect(listed).toHaveLength(2);
  expect(listed[0]).toMatchObject({
    trusted: false,
    origin: { kind: "install", scope: "local" },
    reach: { page: true, host: { server: ["kb-ext-sdk"], page: ["react"] }, builtins: ["node:fs"] },
  });
  expect(listed[0]?.reach?.files.map((file) => file.path)).toEqual(["hello.page.ts", "hello.ts"]);
  expect(listed[1]).toMatchObject({
    enabled: false,
    shadowed: listed[0]?.source,
    origin: { kind: "install", scope: "store" },
  });
});
test("trust records verified installed provenance and offline diff uses the last approved source", async () => {
  await install("one");
  const old = (await rows())[0];
  if (old?.digest === undefined || old.files === undefined) throw new Error("missing review");
  expect(
    await invoke(ctx, {
      id: "sandbox.trust",
      input: {
        digest: old.digest,
        extension: { name: "hello", files: `sha256:${"f".repeat(64)}` },
      },
      approved: true,
    }),
  ).toMatchObject({ status: "failed", code: "invalid_input" });
  expect(
    await invoke(ctx, {
      id: "sandbox.trust",
      input: { digest: old.digest, extension: { name: "hello", files: old.files } },
    }),
  ).toMatchObject({ status: "failed", code: "approval_required" });
  expect(
    await invoke(ctx, {
      id: "sandbox.trust",
      input: { digest: old.digest },
      approved: true,
    }),
  ).toMatchObject({ status: "succeeded" });
  const records = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* CodeTrust).records;
    }).pipe(Effect.provide(codeTrustLayer().pipe(Layer.provide(bunFileSystemLayer)))),
  );
  expect(records).toEqual([
    expect.objectContaining({ digest: old.digest, name: "hello", files: old.files }),
  ]);
  await install("two");
  const current = (await rows())[0];
  expect(current?.trusted).toBe(false);
  const diff = await invoke(ctx, { id: "extension.diff", input: { name: "hello" } });
  expect(diff).toMatchObject({
    status: "succeeded",
    output: {
      from: old.files,
      to: current?.files,
      files: [
        {
          path: "hello.ts",
          from: expect.stringContaining("version=1"),
          to: expect.stringContaining("version=2"),
        },
      ],
    },
  });
});
test("a missing nearer install still reserves its name against a farther trusted copy", async () => {
  await install("one");
  const old = (await rows())[0];
  if (old?.digest === undefined) throw new Error("missing digest");
  await invoke(ctx, { id: "sandbox.trust", input: { digest: old.digest }, approved: true });
  const lock = JSON.parse(await Bun.file(join(ctx.root, ".kb", "extensions.lock.json")).text());
  lock.extensions.hello.locked.files = `sha256:${"f".repeat(64)}`;
  await Effect.runPromise(
    Effect.gen(function* () {
      yield* (yield* ExtensionStorage).mutate((tx) => tx.update(ctx.root, "local", () => lock));
    }).pipe(Effect.provide(kbRuntimeLayer(ctx))),
  );
  resetRegistryCache();
  const listed = await rows();
  expect(listed).toHaveLength(2);
  expect(listed[0]).toMatchObject({ enabled: false, origin: { scope: "local" } });
  expect(listed[1]?.shadowed).toBe("hello");
  expect(listed.some((row) => row.enabled)).toBe(false);
});
