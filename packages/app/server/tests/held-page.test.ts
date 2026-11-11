import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { loadCodeImage } from "@kb/code-image";
import { imagePageFiles, serveStaticEffect } from "../src/assets.ts";

const unexpectedDisk = Effect.fn("heldPage.unexpectedDisk")(function* () {
  return yield* Effect.die(new Error("held delivery accessed the filesystem"));
});
const noDisk = FileSystem.layerNoop({
  exists: unexpectedDisk,
  realPath: unexpectedDisk,
  stat: unexpectedDisk,
  readDirectory: unexpectedDisk,
  readFile: unexpectedDisk,
});

test("delivery uses the exact held closure for index, routes, lazy modules and workers after disk changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "kb-held-page-"));
  try {
    const native = join(root, "native.js");
    const index = join(root, "index.html");
    const lazy = join(root, "lazy.js");
    const worker = join(root, "worker.js");
    await writeFile(native, 'export const version = "held";');
    await writeFile(index, '<script type="module" src="/static/main.js"></script>');
    await writeFile(lazy, "export const value = 1;");
    await writeFile(worker, "postMessage(1)");
    const entries = new Map([
      ["index.html", Bun.file(index)],
      ["static/main.js", new Blob(['import("./lazy.js")'], { type: "text/javascript" })],
      ["static/lazy.js", Bun.file(lazy)],
      ["static/worker.js", Bun.file(worker)],
    ]);
    const held = await Effect.runPromise(loadCodeImage(Bun.file(native), entries));
    expect(held.module).toMatchObject({ version: "held" });
    const files = imagePageFiles(held.image);
    for (const file of [native, index, lazy, worker]) await writeFile(file, "changed after load");
    await mkdir(join(root, "archive/static"), { recursive: true });
    await writeFile(join(root, "archive/static/absent.js"), "unheld archived module");
    await writeFile(join(root, "absent.js"), "unheld disk module");
    const answer = async (pathname: string) => {
      const result = await Effect.runPromise(
        serveStaticEffect(pathname, {
          files,
          dist: root,
          builds: join(root, "archive"),
          embedOrigins: ["https://frame.example"],
        }).pipe(Effect.provide(noDisk)),
      );
      if (result === null) throw new Error("held index missing");
      return HttpServerResponse.toWeb(result);
    };
    for (const pathname of ["/", "/a/client/route"]) {
      const response = await answer(pathname);
      expect(await response.text()).toBe('<script type="module" src="/static/main.js"></script>');
      expect(response.headers.get("Cache-Control")).toBe("no-cache");
      expect(response.headers.get("ETag")).toMatch(/^"sha256:/);
      expect(response.headers.get("Content-Security-Policy")).toBe(
        "frame-ancestors 'self' https://frame.example",
      );
    }
    for (const [path, body] of [
      ["/static/lazy.js", "export const value = 1;"],
      ["/static/worker.js", "postMessage(1)"],
    ] as const) {
      const response = await answer(path);
      expect(await response.text()).toBe(body);
      expect(response.headers.get("Cache-Control")).toContain("immutable");
    }
    expect((await answer("/static/absent.js")).status).toBe(404);
    expect((await answer("/static/../absent.js")).status).toBe(404);
    expect((await answer("/../native.js")).status).toBe(403);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a missing held index returns no page despite a disk index being available", async () => {
  const root = await mkdtemp(join(tmpdir(), "kb-held-missing-"));
  try {
    await writeFile(join(root, "index.html"), "unheld page");
    const held = await Effect.runPromise(
      loadCodeImage(new Blob(["export const ok = true;"]), new Map()),
    );
    const result = await Effect.runPromise(
      serveStaticEffect("/", { files: imagePageFiles(held.image), dist: root }).pipe(
        Effect.provide(noDisk),
      ),
    );
    expect(result).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("production startup serves its held image without ensuring a disk build", async () => {
  const root = await mkdtemp(join(tmpdir(), "kb-held-server-"));
  const held = await Effect.runPromise(
    loadCodeImage(
      new Blob(["export const loaded = true;"]),
      new Map([
        ["index.html", new Blob(["held application"])],
        ["static/worker.js", new Blob(["postMessage('held')"])],
      ]),
    ),
  );
  const { startProductionUi } = await import("../src/server.ts");
  try {
    const { handle, build } = await Effect.runPromise(
      startProductionUi({
        root,
        port: 0,
        openBrowser: false,
        uiRoot: join(root, "missing-ui"),
        codeImage: held.image,
        ensureBuilt: Effect.fn("heldPage.unexpectedBuild")(function* () {
          return yield* Effect.die(new Error("held startup attempted a disk build"));
        }),
      }),
    );
    try {
      expect(build).toEqual({ built: false, state: "fresh" });
      const index = await fetch(handle.url);
      expect(await index.text()).toBe("held application");
      expect(index.headers.get("ETag")).toBe(
        `"${held.image.identity.kind === "packaged" ? held.image.identity.page : ""}"`,
      );
      expect(await (await fetch(new URL("/static/worker.js", handle.url))).text()).toBe(
        "postMessage('held')",
      );
      expect((await fetch(new URL("/static/missing.js", handle.url))).status).toBe(404);
    } finally {
      await Effect.runPromise(handle.stop);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const upgradeImage = async (name: string) =>
  (
    await Effect.runPromise(
      loadCodeImage(
        new Blob(["export {};"]),
        new Map([
          [
            "index.html",
            new Blob([`<script type="module" src="/static/index-${name}.js"></script>`]),
          ],
          [`static/index-${name}.js`, new Blob([`entry ${name}`])],
          [`static/lazy-${name}.js`, new Blob([`lazy ${name}`])],
        ]),
      ),
    )
  ).image;

test("an old tab keeps its held chunks across server upgrades without admitting unheld cache files", async () => {
  const root = await mkdtemp(join(tmpdir(), "kb-held-upgrade-"));
  const builds = join(root, "builds");
  const { startUi } = await import("../src/server.ts");
  const a = await upgradeImage("a");
  const b = await upgradeImage("b");
  const start = (name: string, codeImage: typeof a) =>
    Effect.runPromise(
      startUi({
        root: join(root, name),
        port: 0,
        openBrowser: false,
        builds,
        codeImage,
      }),
    );
  try {
    const first = await start("first", a);
    await Effect.runPromise(first.stop);
    const second = await start("second", b);
    try {
      // Publication came from A's held bytes, and B captures them before listening.
      await writeFile(join(builds, "index-a.js/static/lazy-a.js"), "changed after startup");
      await writeFile(join(builds, "index-b.js/static/unheld.js"), "unheld cache injection");
      expect(await (await fetch(new URL("/static/lazy-a.js", second.url))).text()).toBe("lazy a");
      expect(await (await fetch(new URL("/static/lazy-b.js", second.url))).text()).toBe("lazy b");
      expect((await fetch(new URL("/static/unheld.js", second.url))).status).toBe(404);
      expect((await fetch(new URL("/static/missing.js", second.url))).status).toBe(404);
      expect(a.pageFile("static/lazy-b.js")).toBeNull();
      expect(b.pageFile("static/lazy-a.js")).toBeNull();
    } finally {
      await Effect.runPromise(second.stop);
    }
    const third = await start("third", await upgradeImage("c"));
    try {
      expect(await (await fetch(new URL("/static/lazy-b.js", third.url))).text()).toBe("lazy b");
      expect((await fetch(new URL("/static/unheld.js", third.url))).status).toBe(404);
      expect((await fetch(new URL("/static/lazy-a.js", third.url))).status).toBe(404);
    } finally {
      await Effect.runPromise(third.stop);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
