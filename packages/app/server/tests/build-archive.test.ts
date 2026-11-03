/**
 * A tab of an earlier build keeps being served its chunks after a release
 * (DESIGN-UI.md → Delivery, "A tab outlives its build"; `build-archive.ts`).
 */
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { bunFileSystemLayer } from "@kb/runtime";
import { serveStaticEffect } from "../src/assets.ts";
import { recordBuild } from "../src/build-archive.ts";

/** A `ui/dist` whose entry is `index-<name>.js`, with `chunks` beside it under `static/`. */
async function build(dist: string, name: string, chunks: Record<string, string>): Promise<void> {
  await rm(dist, { recursive: true, force: true });
  await mkdir(join(dist, "static"), { recursive: true });
  await writeFile(
    join(dist, "index.html"),
    `<script type="module" src="/static/index-${name}.js"></script>`,
  );
  await writeFile(join(dist, "static", `index-${name}.js`), `entry ${name}`);
  for (const [file, body] of Object.entries(chunks)) {
    await writeFile(join(dist, "static", file), body);
  }
}

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

async function serve(dist: string, builds: string | null, path: string) {
  const response = await run(
    serveStaticEffect(path, { dist, builds }).pipe(Effect.provide(bunFileSystemLayer)),
  );
  if (response === null) throw new Error("no page");
  const web = HttpServerResponse.toWeb(response);
  return { status: web.status, body: await web.text(), cache: web.headers.get("Cache-Control") };
}

async function record(builds: string, dist: string, keep?: number): Promise<void> {
  await run(recordBuild(builds, dist, keep).pipe(Effect.provide(bunFileSystemLayer)));
}

describe("the builds kept for open tabs", () => {
  test("serve a chunk of an earlier build after a release replaced ui/dist", async () => {
    const at = await mkdtemp(join(tmpdir(), "kb-builds-"));
    const dist = join(at, "dist");
    const builds = join(at, "builds");
    await build(dist, "a", { "gallery-a1.js": "gallery of a" });
    await record(builds, dist);
    await build(dist, "b", { "gallery-b1.js": "gallery of b" });
    await record(builds, dist);

    expect(await serve(dist, builds, "/static/gallery-a1.js")).toEqual({
      status: 200,
      body: "gallery of a",
      cache: "public, max-age=31536000, immutable",
    });
    expect((await serve(dist, builds, "/static/gallery-b1.js")).body).toBe("gallery of b");
  });

  test("answer a chunk no kept build has as missing, never with the page", async () => {
    const at = await mkdtemp(join(tmpdir(), "kb-builds-"));
    const dist = join(at, "dist");
    await build(dist, "a", {});
    expect((await serve(dist, join(at, "builds"), "/static/gone-x.js")).status).toBe(404);
    expect((await serve(dist, null, "/static/gone-x.js")).status).toBe(404);
    // A route of the app is still the page.
    expect((await serve(dist, null, "/node/abc")).body).toContain("index-a.js");
  });

  test("keep the newest builds and forget the files only older ones had", async () => {
    const at = await mkdtemp(join(tmpdir(), "kb-builds-"));
    const dist = join(at, "dist");
    const builds = join(at, "builds");
    await build(dist, "a", { "shared-1.js": "shared", "only-a.js": "a" });
    await record(builds, dist, 2);
    await build(dist, "b", { "shared-1.js": "shared", "only-b.js": "b" });
    await record(builds, dist, 2);
    await build(dist, "c", { "shared-1.js": "shared", "only-c.js": "c" });
    await record(builds, dist, 2);

    expect((await readdir(join(builds, "static"))).toSorted()).toEqual([
      "index-b.js",
      "index-c.js",
      "only-b.js",
      "only-c.js",
      "shared-1.js",
    ]);
    expect((await serve(dist, builds, "/static/only-a.js")).status).toBe(404);
  });

  test("record nothing for a dist with no built page, and never fail the server", async () => {
    const at = await mkdtemp(join(tmpdir(), "kb-builds-"));
    await record(join(at, "builds"), join(at, "no-dist"));
    expect(await readdir(at)).toEqual([]);
  });
});
