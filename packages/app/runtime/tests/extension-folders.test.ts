import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { readClosures, trustedOf } from "../src/extension-loader.ts";
import { bunFileSystemLayer } from "../src/platform.ts";
import { codeTrustLayer } from "@kb/workspace-fs";
import { CodeTrust } from "@kb/contracts";

test("nearer names win before trust; contained folders reject escaping imports", async () => {
  const root = await mkdtemp(join(tmpdir(), "kb-folders-"));
  const near = join(root, "near");
  const far = join(root, "far");
  try {
    await mkdir(near);
    await mkdir(far);
    await writeFile(join(near, "hello.ts"), 'export const name = "near";');
    await writeFile(join(far, "hello.ts"), 'export const name = "far";');
    const farther = { dir: far, origin: "user", contained: false };
    const nearer = { dir: near, origin: "store", contained: false };
    await Effect.runPromise(
      Effect.gen(function* () {
        const old = yield* readClosures([farther]);
        const digest = old.closures[0]?.closure.digest;
        expect(digest).toBeDefined();
        if (digest === undefined) throw new Error("missing fixture closure");
        yield* (yield* CodeTrust).trust(digest);
        const read = yield* readClosures([nearer, farther]);
        expect(read.closures.map(({ path }) => path)).toEqual([join(near, "hello.ts")]);
        expect(read.failures).toEqual([
          {
            file: join(far, "hello.ts"),
            error: `shadowed by ${join(near, "hello.ts")}; hidden from user`,
          },
        ]);
        expect((yield* trustedOf(read.closures)).trusted).toEqual([]);
      }).pipe(Effect.provide(codeTrustLayer().pipe(Layer.provideMerge(bunFileSystemLayer)))),
    );
    await writeFile(
      join(near, "hello.ts"),
      'import {defineExtension} from "kb-ext-sdk"; export const value = defineExtension;',
    );
    const host = await Effect.runPromise(
      readClosures([{ ...nearer, contained: true }]).pipe(Effect.provide(bunFileSystemLayer)),
    );
    expect(host.failures).toEqual([]);
    expect(host.closures).toHaveLength(1);
    await writeFile(join(root, "outside.ts"), "export const value = 42;");
    await writeFile(join(near, "hello.ts"), 'export { value } from "../outside.ts";');
    const read = await Effect.runPromise(
      readClosures([{ ...nearer, contained: true }]).pipe(Effect.provide(bunFileSystemLayer)),
    );
    expect(read.closures).toHaveLength(0);
    expect(read.failures[0]?.error).toContain("escapes its folder");
    const ordinary = await Effect.runPromise(
      readClosures([nearer]).pipe(Effect.provide(bunFileSystemLayer)),
    );
    expect(ordinary.closures).toHaveLength(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.each(["helper-link", "parent-package", "folder-link"])(
  "contained folder: %s",
  async (kind) => {
    const root = await mkdtemp(join(tmpdir(), "kb-contained-"));
    const dir = join(root, "extension");
    try {
      await mkdir(dir);
      let folder = dir;
      if (kind === "helper-link") {
        await writeFile(join(root, "outside.ts"), "export const value = 42;");
        await symlink(join(root, "outside.ts"), join(dir, "helper.ts"));
        await writeFile(join(dir, "hello.ts"), 'export { value } from "./helper.ts";');
      } else if (kind === "parent-package") {
        const pkg = join(root, "node_modules", "outside");
        await mkdir(pkg, { recursive: true });
        await writeFile(join(pkg, "package.json"), '{"name":"outside","main":"index.js"}');
        await writeFile(join(pkg, "index.js"), "export const value = 42;");
        await writeFile(join(dir, "hello.ts"), 'export { value } from "outside";');
      } else {
        await writeFile(join(dir, "hello.ts"), "export const value = 42;");
        folder = join(root, "linked");
        await symlink(dir, folder);
      }
      const read = await Effect.runPromise(
        readClosures([{ dir: folder, origin: "fixture", contained: true }]).pipe(
          Effect.provide(bunFileSystemLayer),
        ),
      );
      if (kind === "folder-link") {
        expect(read.failures).toEqual([]);
        expect(read.closures).toHaveLength(1);
      } else {
        expect(read.closures).toHaveLength(0);
        expect(read.failures[0]?.error).toContain("escapes its folder");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
