/**
 * A tab of an earlier build keeps being served its chunks after a release
 * (DESIGN-UI.md → Delivery, "A tab outlives its build"; `build-archive.ts`).
 */
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { bunFileSystemLayer } from "@kb/runtime";
import { serveStaticEffect } from "../src/assets.ts";
import { entryScriptOf, recordBuild } from "../src/build-archive.ts";

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

  test("keep the newest builds, each whole, and forget the older ones", async () => {
    const at = await mkdtemp(join(tmpdir(), "kb-builds-"));
    const dist = join(at, "dist");
    const builds = join(at, "builds");
    for (const name of ["a", "b", "c"]) {
      await build(dist, name, { "shared-1.js": "shared", [`only-${name}.js`]: name });
      await record(builds, dist, 2);
    }

    expect((await readdir(builds)).toSorted()).toEqual(["index-b.js", "index-c.js"]);
    expect((await serve(dist, builds, "/static/only-a.js")).status).toBe(404);
    expect((await serve(dist, builds, "/static/only-b.js")).body).toBe("b");
  });

  test("count a build a server starts on again as new, without copying it again", async () => {
    const at = await mkdtemp(join(tmpdir(), "kb-builds-"));
    const builds = join(at, "builds");
    const dists = { a: join(at, "a"), b: join(at, "b"), c: join(at, "c") };
    for (const [name, dist] of Object.entries(dists)) await build(dist, name, {});
    await record(builds, dists.a, 2);
    await record(builds, dists.b, 2);
    await record(builds, dists.a, 2);
    await record(builds, dists.c, 2);

    expect((await readdir(builds)).toSorted()).toEqual(["index-a.js", "index-c.js"]);
  });

  test("keep every build of servers that start at once on one archive", async () => {
    const at = await mkdtemp(join(tmpdir(), "kb-builds-"));
    const builds = join(at, "builds");
    const names = ["a", "b", "c", "d", "e", "f"];
    for (const name of names) await build(join(at, name), name, { [`only-${name}.js`]: name });
    await Promise.all(names.map((name) => record(builds, join(at, name))));

    expect((await readdir(builds)).toSorted()).toEqual(names.map((name) => `index-${name}.js`));
    for (const name of names) {
      expect((await serve(join(at, "a"), builds, `/static/only-${name}.js`)).body).toBe(name);
    }
  });

  test("never serve a file outside a kept build's own files, whatever a link says", async () => {
    const at = await mkdtemp(join(tmpdir(), "kb-builds-"));
    const dist = join(at, "dist");
    const builds = join(at, "builds");
    await build(dist, "a", {});
    await record(builds, dist);
    await writeFile(join(at, "secret.txt"), "not a chunk");
    await symlink(join(at, "secret.txt"), join(builds, "index-a.js", "static", "leak.js"));

    expect((await serve(dist, builds, "/static/leak.js")).status).toBe(404);
    expect((await serve(dist, builds, "/static/../build.json")).status).not.toBe(200);
  });

  test("record nothing for a dist with no built page, and never fail the server", async () => {
    const at = await mkdtemp(join(tmpdir(), "kb-builds-"));
    await record(join(at, "builds"), join(at, "no-dist"));
    expect(await readdir(at)).toEqual([]);
  });
});

describe("the build a page loads", () => {
  test("is the module script the page's index.html loads, whatever its attributes' order", () => {
    expect(
      entryScriptOf(
        '<script>var a</script><script type="module" crossorigin src="/static/index-fENRSP5E.js"></script>',
      ),
    ).toBe("/static/index-fENRSP5E.js");
    expect(entryScriptOf("<script src='/s/x.js' type=module></script>")).toBe("/s/x.js");
    expect(entryScriptOf('<script src="/legacy.js"></script>')).toBeNull();
    expect(entryScriptOf("<p>no page</p>")).toBeNull();
  });
});
