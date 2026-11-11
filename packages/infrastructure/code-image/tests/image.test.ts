import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Effect, Result } from "effect";
import { loadCodeImage } from "../src/index.ts";

const native = () => new Blob(['export const captured = "original";']);
const pages = () =>
  new Map([
    ["index.html", new Blob(['<script type="module" src="/static/main.js"></script>'])],
    ["static/main.js", new Blob(['import("./lazy.js")'])],
    ["static/lazy.js", new Blob(["export const lazy = 1;"])],
    ["static/worker.js", new Blob(["postMessage(1)"])],
  ]);

test("loads held native bytes and serves held files after original files and maps change", async () => {
  const root = await mkdtemp(join(tmpdir(), "kb-code-image-"));
  try {
    const file = join(root, "native.js");
    await writeFile(file, 'export const captured = "original";');
    const page = pages();
    const worker = join(root, "worker.js");
    await writeFile(worker, "postMessage(1)");
    page.set("static/worker.js", Bun.file(worker));
    const result = await Effect.runPromise(loadCodeImage(Bun.file(file), page));
    const identity = result.image.identity;
    await writeFile(file, 'throw new Error("changed after loading")');
    page.set("static/lazy.js", new Blob(["changed"]));
    await writeFile(worker, "postMessage(2)");
    expect(result.module).toMatchObject({ captured: "original" });
    expect(await result.image.pageFile("static/lazy.js")?.text()).toBe("export const lazy = 1;");
    expect(await result.image.pageFile("static/worker.js")?.text()).toBe("postMessage(1)");
    expect(result.image.identity).toBe(identity);
    expect(result.image.pageFile("../native.js")).toBeNull();
    expect(result.image.pageFile("missing.js")).toBeNull();
    expect(Object.isFrozen(identity)).toBe(true);
    expect(Object.isFrozen(result.image.pageNames)).toBe(true);
    expect(result.image.pageNames).toEqual([...pages().keys()].toSorted());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("closure identity includes lazy chunks and workers and ignores map enumeration order", async () => {
  const initial = await Effect.runPromise(loadCodeImage(native(), pages()));
  const reversed = await Effect.runPromise(
    loadCodeImage(native(), new Map([...pages()].toReversed())),
  );
  expect(initial.image.identity.kind).toBe("packaged");
  if (initial.image.identity.kind !== "packaged" || reversed.image.identity.kind !== "packaged")
    throw new Error("packaged image");
  expect(reversed.module).not.toBe(initial.module);
  expect(reversed.image.identity.page).toBe(initial.image.identity.page);
  expect(reversed.image.identity.native).toBe(initial.image.identity.native);
  expect(reversed.image.identity.generation).not.toBe(initial.image.identity.generation);
  for (const name of ["static/lazy.js", "static/worker.js"]) {
    const changed = pages();
    changed.set(name, new Blob(["changed"]));
    const result = await Effect.runPromise(loadCodeImage(native(), changed));
    if (result.image.identity.kind !== "packaged") throw new Error("packaged image");
    expect(result.image.identity.page).not.toBe(initial.image.identity.page);
  }
  const changed = await Effect.runPromise(
    loadCodeImage(new Blob(['export const captured = "new";']), pages()),
  );
  if (changed.image.identity.kind !== "packaged") throw new Error("packaged image");
  expect(changed.image.identity.native).not.toBe(initial.image.identity.native);
});

test("a native import that fails cannot publish an image identity", async () => {
  const result = await Effect.runPromise(
    Effect.result(loadCodeImage(new Blob(['throw new Error("load refused")']), pages())),
  );
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) expect(result.failure.message).toContain("load refused");
});
