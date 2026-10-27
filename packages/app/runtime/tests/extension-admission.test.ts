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
import { chmod, mkdtemp, rm } from "node:fs/promises";
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

  test("a file named so it can never be an extension is a failure that names it", async () => {
    await writeExtension(root, "-bad.ts", extensionModule("bad"));
    expect(await refused()).toEqual(["-bad.ts"]);
  });

  test("code that is no entry kb discovers is a failure, not a file nobody runs", async () => {
    for (const file of ["hello.tsx", "hello.js", "hello.mts", "hello.page.js"]) {
      await writeExtension(root, file, extensionModule("hello"));
    }
    // Declarations, notes and helper directories are not code kb would run as an entry.
    for (const file of ["types.d.ts", "types.d.mts", "types.d.cts"]) {
      await writeExtension(root, file, "export {};\n");
    }
    await writeExtension(root, "README.md", "notes\n");
    await writeExtension(root, "lib/helper.ts", "export const helped = true;\n");
    expect((await refused()).toSorted()).toEqual([
      "hello.js",
      "hello.mts",
      "hello.page.js",
      "hello.tsx",
    ]);
  });

  test("a page half that does not bundle is a failure", async () => {
    await writeExtension(root, "paged.ts", extensionModule("paged"));
    await writeExtension(
      root,
      "paged.page.tsx",
      'import { gone } from "./nowhere.ts";\nexport default gone;\n',
    );
    expect(await refused()).toEqual(["paged.ts"]);
  });

  test("an extensions directory that cannot be read is a failure, never a root with none", async () => {
    if (process.getuid?.() === 0) return; // root reads a directory whatever its mode says
    await writeExtension(root, "fine.ts", extensionModule("fine"));
    const dir = join(root, ".kb", "extensions");
    await chmod(dir, 0o000);
    try {
      expect((await admit()).map(({ file }) => file)).toEqual([".kb/extensions"]);
    } finally {
      await chmod(dir, 0o755);
    }
  });

  test("a module that ends the process as it loads fails its own load, and the gate runs on", async () => {
    await writeExtension(root, "quits.ts", `process.exit(0);\n${extensionModule("quits")}`);
    await writeExtension(root, "really.ts", `process.reallyExit(0);\n${extensionModule("really")}`);
    expect((await refused()).toSorted()).toEqual(["quits.ts", "really.ts"]);
    // Admission gives the process its own exits back.
    expect(process.exit.toString()).not.toContain("while it was admitted");
    expect(process.reallyExit.toString()).not.toContain("while it was admitted");
  });
});
