/**
 * Admission (DESIGN.md → Core boundary & extensions → repository
 * extensions): the one operation that says whether a root's repository
 * extensions all load. Runtime discovery warns and skips a module that does
 * not; admission composes the same families the same way, every one of them
 * on and every closure taken as vouched for, and answers every failure, so
 * a malformed extension fails a gate instead of silently disappearing. It
 * vouches for nothing on this machine: the root's trust record is untouched.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Effect, Layer } from "effect";
import { CodeTrust } from "@kb/contracts";
import { codeTrustLayer } from "@kb/workspace-fs";
import { extensionModule, writeExtension } from "@kb/test-kit";
import { closureOf } from "../src/extension-loader.ts";
import { admitExtensions } from "../src/registry.ts";
import { bunFileSystemLayer } from "../src/platform.ts";

const action = (id: string) => `{
  id: ${JSON.stringify(id)},
  title: "A",
  description: "a repository action",
  mode: { kind: "read" },
  inputSchema: { parse: (input) => input },
  outputSchema: { parse: (output) => output },
  handler: async () => ({}),
}`;

let root = "";

const admit = () =>
  Effect.runPromise(admitExtensions(root).pipe(Effect.provide(bunFileSystemLayer)));
/** The files admission refused, by name: a load failure names the file by path. */
const refused = async () => (await admit()).map(({ file }) => basename(file));

const trustedHere = (file: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { digest } = yield* closureOf(root, file);
      return yield* (yield* CodeTrust).trusted([digest]);
    }).pipe(Effect.provide(codeTrustLayer(root).pipe(Layer.provideMerge(bunFileSystemLayer)))),
  );

describe("admitting a root's repository extensions", () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kb-extension-admission-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("a root with none admits the bundled families, every one on, with no failure", async () => {
    expect(await admit()).toEqual([]);
  });

  test("an extension that loads is admitted, untrusted, and stays untrusted", async () => {
    await writeExtension(root, "fine.ts", extensionModule("fine", { actions: `[${action("a")}]` }));
    expect(await admit()).toEqual([]);
    expect(await trustedHere("fine.ts")).toEqual([]);
  });

  test("a module that does not compile is a failure that names it", async () => {
    await writeExtension(root, "broken.ts", "export const declaration = {;\n");
    const failures = await admit();
    expect(failures.map(({ file }) => basename(file))).toEqual(["broken.ts"]);
  });

  test("a module that is no extension is a failure that names it", async () => {
    await writeExtension(root, "bare.ts", "export const nothing = 1;\n");
    expect(await refused()).toEqual(["bare.ts"]);
  });

  test("a family whose name is a bundled one's is a failure", async () => {
    await writeExtension(root, "canvas.ts", extensionModule("canvas"));
    expect(await refused()).toEqual(["canvas.ts"]);
  });

  test("two actions under one id are a failure", async () => {
    await writeExtension(
      root,
      "twice.ts",
      extensionModule("twice", { actions: `[${action("a")}, ${action("a")}]` }),
    );
    expect(await refused()).toContain("twice.ts");
  });

  test("an action that is a batch of an action nobody registers is a failure", async () => {
    const batch = action("b").replace(
      'mode: { kind: "read" },',
      'mode: { kind: "read" },\n  batchOf: ["ext.nobody.x"],',
    );
    await writeExtension(root, "batch.ts", extensionModule("batch", { actions: `[${batch}]` }));
    expect(await refused()).toContain("batch.ts");
  });

  test("an optional family off by default is admitted as if on", async () => {
    await writeExtension(
      root,
      "off.ts",
      extensionModule("off", {
        declaration: JSON.stringify({
          name: "off",
          label: "off",
          optional: true,
          defaultOn: false,
        }),
        actions: `[${action("a")}, ${action("a")}]`,
      }),
    );
    expect(await refused()).toContain("off.ts");
  });
});
