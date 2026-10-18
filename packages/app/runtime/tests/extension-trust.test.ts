/**
 * An approved repository extension runs with the owner's power, so a
 * root's `.kb/extensions/<name>.ts` runs only once a person has trusted its
 * closure on this machine (DESIGN.md → Core boundary & extensions →
 * repository extensions): an untrusted one is skipped, naming its digest; a
 * trusted one loads; and a file edited since it was trusted is new code
 * nobody has trusted yet. Trust is the root's code trust, the one sandboxed
 * code is trusted in.
 *
 * The approval covers what runs. Every file the extension loads is in its
 * closure, however it is reached (a relative import, a literal `require` or
 * `import()`, a tsconfig path, a package import, a package the root
 * carries or one outside it, a link to a helper, or the extension itself a
 * link), so it runs only as the bytes a person approved, and an edit to any
 * of them is new code. Code the closure cannot see refuses the extension
 * before any of it runs: a `createRequire`, a function made at run time, an
 * `eval`, a computed `import()`, a `require` of a name it builds, a builtin
 * that loads code, a Worker, an import that does not resolve (a query Bun
 * would read past its hooks among them), in either half. What is imported
 * is the closure's bytes, not the files as they are by then, and a digest
 * trusted later in the same process is the one that runs.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { ActionPoint, CodeTrust, type LoadedExtension } from "@kb/contracts";
import { makeKernel } from "@kb/plugin";
import {
  extensionModule,
  trustExtension,
  writeExtension,
  writeTrustedExtension,
} from "@kb/test-kit";
import { closureOf, discoverExtensions } from "../src/extension-loader.ts";
import { bunFileSystemLayer } from "../src/platform.ts";
import { registryFor, resetRegistryCache } from "../src/registry.ts";

const HELLO = extensionModule("hello", {
  actions: `[{
  id: "hello",
  title: "Hello",
  description: "a repository extension",
  mode: { kind: "read" },
  inputSchema: { parse: (input) => input },
  outputSchema: { parse: (output) => output },
  handler: async () => ({ hello: true }),
}]`,
});

/** A helper that leaves `said` in `mark` when it runs. */
const helper = (mark: string, said = "ran") =>
  `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(mark)}, ${JSON.stringify(said)});\nexport const helped = true;\n`;
const extension = (prelude: string) => `${prelude}\n${HELLO}`;

let root = "";

/** What the `hello` action an extension's entry contributes answers, run as its kernel holds it. */
const helloOf = (extensions: readonly LoadedExtension[]) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const kernel = makeKernel();
      for (const { entry } of extensions) yield* kernel.load(entry);
      const action = kernel.lookup(ActionPoint, "ext.hello.hello")?.value;
      yield* kernel.shutdown;
      return yield* Effect.promise(async () =>
        action?.handler?.(undefined as never, undefined as never),
      );
    }),
  );

const registry = () => {
  resetRegistryCache();
  return Effect.runPromise(registryFor(root).pipe(Effect.provide(bunFileSystemLayer)));
};
const loads = async () => (await registry()).actions.some((a) => a.def.id === "ext.hello.hello");

/** Every way the extension below reaches a helper, each set up in `root`. */
async function helpers(mark: string): Promise<void> {
  // Beside the extension, where discovery does not look, and trusted by nobody on its own.
  await mkdir(join(root, ".kb", "extensions", "lib"), { recursive: true });
  await writeFile(join(root, ".kb", "extensions", "lib", "helper.ts"), helper(mark));
  await writeFile(join(root, "outside.ts"), helper(mark));
  await symlink(join(root, "outside.ts"), join(root, ".kb", "extensions", "lib", "link.ts"));
  // Resolution the root configures: a path alias, and an import map.
  await writeFile(
    join(root, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { paths: { "@helpers/*": ["./*"] } } }),
  );
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "root", imports: { "#outside": "./outside.ts" } }),
  );
  // A package the root carries, and one it links to elsewhere in itself.
  const pkg = join(root, "node_modules", "carried");
  await mkdir(pkg, { recursive: true });
  await writeFile(join(pkg, "package.json"), JSON.stringify({ name: "carried", main: "index.js" }));
  await writeFile(join(pkg, "index.js"), helper(mark).replace("export const helped = true;", ""));
  const vendored = join(root, "vendor", "linked");
  await mkdir(vendored, { recursive: true });
  await writeFile(
    join(vendored, "package.json"),
    JSON.stringify({ name: "linked", main: "index.js" }),
  );
  await writeFile(
    join(vendored, "index.js"),
    helper(mark).replace("export const helped = true;", ""),
  );
  await symlink(vendored, join(root, "node_modules", "linked"));
}

describe("a root's repository extensions", () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kb-extension-trust-"));
  });
  afterEach(async () => {
    resetRegistryCache();
    await rm(root, { recursive: true, force: true });
  });

  test("an untrusted extension is never imported, and its failure names its digest", async () => {
    await writeExtension(root, "hello.ts", HELLO);
    const { failures } = await registry();
    expect(await loads()).toBe(false);
    expect(failures).toEqual([
      {
        file: "hello.ts",
        error: expect.stringMatching(/^not trusted on this machine \(sha256:[0-9a-f]{64}\)/),
      },
    ]);
  });

  test("a trusted extension loads, and an edit since is untrusted again", async () => {
    await writeExtension(root, "hello.ts", HELLO);
    await trustExtension(root, "hello.ts");
    expect(await loads()).toBe(true);
    await writeExtension(root, "hello.ts", HELLO.replace("hello: true", "hello: false"));
    expect(await loads()).toBe(false);
  });

  describe("the approval covers what runs", () => {
    test.each([
      ["a static import of another file", `import "./lib/helper.ts";`, "lib/helper.ts"],
      ["an import out of the extensions directory", `import "../../outside.ts";`, "outside.ts"],
      ["a helper that is a link", `import "./lib/link.ts";`, "outside.ts"],
      ["a package the root carries", `import "carried";`, "node_modules/carried/index.js"],
      ["a package the root carries through a link", `import "linked";`, "vendor/linked/index.js"],
      ["a literal require", `const { helped } = require("./lib/helper.ts");`, "lib/helper.ts"],
      ["a literal import()", `await import("../../outside.ts");`, "outside.ts"],
      ["a tsconfig path", `import "@helpers/outside";`, "outside.ts"],
      ["a package import", `import "#outside";`, "outside.ts"],
    ])(
      "%s runs as the bytes approved, and an edit to it is new code",
      async (_how, prelude, helperPath) => {
        const mark = join(root, "ran");
        await helpers(mark);
        await writeTrustedExtension(root, "hello.ts", extension(prelude));
        expect(await loads()).toBe(true);
        expect(await readFile(mark, "utf8")).toBe("ran");

        // The helper, wherever it is, edited after the approval.
        const path = helperPath.startsWith("lib/")
          ? join(root, ".kb", "extensions", helperPath)
          : join(root, helperPath);
        const edited = helper(mark, "edited");
        await writeFile(
          path,
          path.endsWith(".js") ? edited.replace("export const helped = true;", "") : edited,
        );
        const { failures } = await registry();
        expect(await loads()).toBe(false);
        expect(failures).toEqual([
          { file: "hello.ts", error: expect.stringContaining("not trusted on this machine") },
        ]);
        expect(await readFile(mark, "utf8")).toBe("ran");
      },
    );

    test("code outside the root, named by its absolute path, is in the closure too", async () => {
      const mark = join(root, "ran");
      const elsewhere = await mkdtemp(join(tmpdir(), "kb-outside-"));
      try {
        const installed = join(elsewhere, "installed.ts");
        await writeFile(installed, helper(mark));
        await writeTrustedExtension(
          root,
          "hello.ts",
          extension(`import ${JSON.stringify(installed)};`),
        );
        expect(await loads()).toBe(true);
        await writeFile(installed, helper(mark, "edited"));
        expect(await loads()).toBe(false);
        expect(await readFile(mark, "utf8")).toBe("ran");
      } finally {
        await rm(elsewhere, { recursive: true, force: true });
      }
    });

    test("an extension that is a link runs its target's approved bytes, and an edit to it is new code", async () => {
      const target = join(root, "hello-source.ts");
      await writeFile(target, HELLO);
      await mkdir(join(root, ".kb", "extensions"), { recursive: true });
      await symlink(target, join(root, ".kb", "extensions", "hello.ts"));
      await trustExtension(root, "hello.ts");
      expect(await loads()).toBe(true);
      await writeFile(target, HELLO.replace("hello: true", "hello: false"));
      expect(await loads()).toBe(false);
    });

    test("an edit to the page half is new code too", async () => {
      await writeExtension(root, "hello.page.ts", 'export const page = "first";\n');
      await writeTrustedExtension(root, "hello.ts", HELLO);
      expect(await loads()).toBe(true);
      await writeExtension(root, "hello.page.ts", 'export const page = "second";\n');
      expect(await loads()).toBe(false);
    });

    test.each([
      [
        "a createRequire",
        `import { createRequire } from "node:module";\ncreateRequire(import.meta.url)("../../outside.ts");`,
        /imports module, which loads code/,
      ],
      [
        "a function made at run time that imports",
        `await new Function("p", "return im" + "port(p)")("../../outside.ts");`,
        /uses the Function constructor/,
      ],
      [
        "an eval of a file it reads",
        `await eval(await Bun.file("OUTSIDE_JS").text());`,
        /uses eval/,
      ],
      [
        "a computed import",
        `await import(["..", "..", "outside.ts"].join("/"));`,
        /imports a computed name/,
      ],
      [
        "a require of a name it builds",
        `const r = require; r("../../outside.ts");`,
        /uses a require the bundle cannot follow/,
      ],
      [
        "a require of a builtin, which only import names",
        `const fs = require("node:fs");`,
        /uses a require the bundle cannot follow/,
      ],
      [
        "a builtin that runs code",
        `import { runInThisContext } from "node:vm";\nrunInThisContext("1");`,
        /imports vm/,
      ],
      ["a Worker", `new Worker("../../outside.ts");`, /uses a Worker/],
      ["an import that does not resolve", `import "./lib/missing.ts";`, /does not bundle/],
      // Bun's runtime reads such a specifier from disk, past its load hooks.
      ["an import whose query holds a colon", `import "../../outside.ts?a:b";`, /does not bundle/],
    ])("%s refuses the extension before any of it runs", async (_how, prelude, why) => {
      const mark = join(root, "ran");
      await writeFile(join(root, "outside.ts"), helper(mark));
      await writeFile(join(root, "outside.js"), `Bun.write(${JSON.stringify(mark)}, "ran");`);
      await writeExtension(
        root,
        "hello.ts",
        extension(prelude.replace("OUTSIDE_JS", join(root, "outside.js"))),
      );
      const { failures } = await registry();
      expect(await loads()).toBe(false);
      expect(failures).toEqual([{ file: "hello.ts", error: expect.stringMatching(why) }]);
      expect(existsSync(mark)).toBe(false);
    });

    test("a page half that evaluates code refuses the extension", async () => {
      await writeExtension(root, "hello.page.ts", 'export const page = eval("1");\n');
      await writeExtension(root, "hello.ts", HELLO);
      const { failures } = await registry();
      expect(failures).toEqual([
        { file: "hello.ts", error: expect.stringMatching(/^its page half uses eval/) },
      ]);
    });

    test("a page half with no server entry is reported, and runs nowhere", async () => {
      await writeExtension(root, "stray.page.tsx", "export default {};\n");
      const { failures } = await registry();
      expect(failures).toEqual([
        { file: "stray.page.tsx", error: "a page entry of stray, which has no stray.ts" },
      ]);
    });

    test("the digest is the files', wherever the process runs from", async () => {
      await mkdir(join(root, ".kb", "extensions", "lib"), { recursive: true });
      await writeFile(
        join(root, ".kb", "extensions", "lib", "helper.ts"),
        helper(join(root, "ran")),
      );
      await writeExtension(root, "hello.ts", extension(`import "./lib/helper.ts";`));
      const digest = () =>
        Effect.runPromise(closureOf(root, "hello.ts").pipe(Effect.provide(bunFileSystemLayer)));
      const here = process.cwd();
      const first = await digest();
      process.chdir(root);
      try {
        expect(await digest()).toEqual(first);
      } finally {
        process.chdir(here);
      }
    });

    test("a digest trusted after another ran in this process is the one that runs", async () => {
      const said = async () =>
        (await registry()).actions.find((a) => a.def.id === "ext.hello.hello")?.def.description;
      await writeTrustedExtension(root, "hello.ts", HELLO);
      expect(await said()).toBe("a repository extension");
      const edited = HELLO.replace("a repository extension", "edited since");
      await writeExtension(root, "hello.ts", edited);
      expect(await said()).toBeUndefined();
      await trustExtension(root, "hello.ts");
      expect(await said()).toBe("edited since");
    });

    test("what runs is the closure that was trusted, not the files as they are by then", async () => {
      const path = await writeTrustedExtension(root, "hello.ts", HELLO);
      const swapped = HELLO.replace("hello: true", "hello: false");
      const discovered = await Effect.runPromise(
        discoverExtensions(root).pipe(
          Effect.provideService(CodeTrust, {
            // The file changes after its closure is read, before it is imported.
            trusted: (digests) =>
              Effect.sync(() => {
                writeFileSync(path, swapped);
                return [...digests];
              }),
            trust: () => Effect.void,
            untrust: () => Effect.void,
          }),
          Effect.provide(bunFileSystemLayer),
        ),
      );
      expect(await readFile(path, "utf8")).toBe(swapped);
      expect(await helloOf(discovered.extensions)).toEqual({ hello: true });
    });
  });
});
