import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Result } from "effect";
import { loadPackagedProgram } from "../src/package-image.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "kb-package-image-"));
  roots.push(root);
  const page = join(root, "packages/app/ui/dist");
  await mkdir(join(page, "static/nested"), { recursive: true });
  await writeFile(join(page, "index.html"), "captured index");
  await writeFile(join(page, ".hidden.js"), "hidden executable");
  await writeFile(join(page, "static/nested/worker.js"), "captured worker");
  await writeFile(
    join(root, "program.js"),
    `export async function main(argv, image) {
    return image.identity.kind === "packaged"
      && image.pageNames.includes(".hidden.js")
      && await image.pageFile("static/nested/worker.js").text() === "captured worker" ? 37 : 1;
  }`,
  );
  return { root, page };
}

test("the packaged program invokes the captured module with that exact complete page image", async () => {
  const { root, page } = await fixture();
  const program = await Effect.runPromise(loadPackagedProgram(root));
  await writeFile(join(root, "program.js"), "export const main = () => 99;");
  await writeFile(join(page, "static/nested/worker.js"), "changed");
  await rm(join(page, ".hidden.js"));
  expect(await program.main([])).toBe(37);
});

test("a missing index refuses before evaluating the native artifact", async () => {
  const { root, page } = await fixture();
  await rm(join(page, "index.html"));
  const marker = join(root, "evaluated");
  await writeFile(
    join(root, "program.js"),
    `import {writeFileSync} from "node:fs";writeFileSync(${JSON.stringify(marker)}, "ran");`,
  );
  const result = await Effect.runPromise(Effect.result(loadPackagedProgram(root)));
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) expect(result.failure.message).toContain("no index.html");
  expect(await Bun.file(marker).exists()).toBe(false);
});

for (const target of ["page", "native"] as const)
  test(`a ${target} artifact outside the package is refused`, async () => {
    const { root, page } = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "kb-package-outside-"));
    roots.push(outside);
    const file = join(outside, "outside.js");
    await writeFile(file, "export const main = () => 0;");
    const replaced =
      target === "page" ? join(page, "static/nested/worker.js") : join(root, "program.js");
    await rm(replaced);
    await symlink(file, replaced);
    const result = await Effect.runPromise(Effect.result(loadPackagedProgram(root)));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure.message).toContain("not contained");
  });

test("a held artifact without the program export is refused", async () => {
  const { root } = await fixture();
  await writeFile(join(root, "program.js"), "export const main = 1;");
  const result = await Effect.runPromise(Effect.result(loadPackagedProgram(root)));
  expect(Result.isFailure(result)).toBe(true);
});

test("a directory symlink cannot hide an uncaptured executable subtree", async () => {
  const { root, page } = await fixture();
  const outside = await mkdtemp(join(tmpdir(), "kb-package-dir-outside-"));
  roots.push(outside);
  await writeFile(join(outside, "worker.js"), "uncaptured worker");
  const directory = join(page, "static/nested");
  await rm(directory, { recursive: true });
  await symlink(outside, directory);
  const result = await Effect.runPromise(Effect.result(loadPackagedProgram(root)));
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) expect(result.failure.message).toContain("not contained");
});
