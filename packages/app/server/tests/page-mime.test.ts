import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { loadCodeImage } from "@kb/code-image";
import { bunFileSystemLayer } from "@kb/runtime";
import { captureKeptFiles } from "../src/build-archive.ts";
import {
  imagePageFiles,
  serveStaticEffect,
  withPageHistory,
  type PageFiles,
} from "../src/assets.ts";

const fixtures = [
  ["index.html", "<html>page</html>", /^text\/html(?:;|$)/],
  ["static/lazy.js", "export const lazy = true;", /^(?:text|application)\/javascript(?:;|$)/],
  ["static/theme.css", "body {color:red}", /^text\/css(?:;|$)/],
  ["static/worker.wasm", Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0), /^application\/wasm(?:;|$)/],
] as const;

for (const source of ["directory", "image", "history"] as const)
  test(`${source}: page MIME follows the selected file, including executable chunks and SPA routes`, async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-page-mime-"));
    try {
      let files: PageFiles | undefined;
      const directory = source === "history" ? join(root, "old") : root;
      for (const [name, body] of fixtures) {
        await mkdir(dirname(join(directory, name)), { recursive: true });
        await writeFile(join(directory, name), body);
      }
      if (source !== "directory") {
        const page = new Map<string, Blob>(
          fixtures
            .filter(([name]) => source === "image" || name === "index.html")
            .map(([name]) => [name, Bun.file(join(directory, name))]),
        );
        const held = await Effect.runPromise(loadCodeImage(new Blob(["export {};"]), page));
        files = imagePageFiles(held.image);
        if (source === "history") {
          await writeFile(
            join(directory, "build.json"),
            JSON.stringify({ build: "/static/lazy.js", at: 1 }),
          );
          const history = await Effect.runPromise(
            captureKeptFiles(root).pipe(Effect.provide(bunFileSystemLayer)),
          );
          files = withPageHistory(files, history);
        }
      }
      const answer = async (path: string) => {
        const result = await Effect.runPromise(
          serveStaticEffect(path, { dist: root, files, builds: null }).pipe(
            Effect.provide(source === "directory" ? bunFileSystemLayer : FileSystem.layerNoop({})),
          ),
        );
        if (result === null) throw new Error("page missing");
        return HttpServerResponse.toWeb(result);
      };
      for (const [name, body, mime] of fixtures) {
        const response = await answer(`/${name}`);
        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type") ?? "").toMatch(mime);
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(
          typeof body === "string" ? new TextEncoder().encode(body) : body,
        );
      }
      expect((await answer("/node/n.example")).headers.get("Content-Type") ?? "").toMatch(
        /^text\/html(?:;|$)/,
      );
      expect((await answer("/static/unheld.js")).status).toBe(404);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
