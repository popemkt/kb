import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, writeFile, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { KB_SOURCE_BIN, extensionModule, writeTrustedExtension } from "@kb/test-kit";

const repository = join(import.meta.dir, "../../../..");
let scratch: string;
let release: string;
beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "kb-startup-contract-"));
  release = join(scratch, "release with spaces");
  const lib = join(release, "lib/kb");
  await mkdir(lib, { recursive: true });
  await mkdir(join(release, "bin"));
  const built = Bun.spawn(["sh", join(repository, "bin/build-cli"), lib], {
    cwd: repository,
    stdout: "ignore",
    stderr: "pipe",
  });
  const error = await new Response(built.stderr).text();
  if ((await built.exited) !== 0) throw new Error(error);
  expect((await readdir(lib)).toSorted()).toEqual(["cli.js", "program.js"]);
  await mkdir(join(lib, "packages/app/ui/dist"), { recursive: true });
  await writeFile(join(lib, "packages/app/ui/dist/index.html"), "startup fixture");
  await mkdir(join(lib, "packages/app/ui/dist/static"));
  await writeFile(join(lib, "packages/app/ui/dist/static/lazy.js"), "held lazy module");
  await writeFile(join(lib, "packages/app/ui/dist/static/worker.js"), "held worker");
  await copyFile(join(repository, "bin/kb-bun"), join(lib, "launch"));
  await copyFile(
    join(repository, "packages/infrastructure/child-process/src/kb-launch-flags.txt"),
    join(lib, "launch-flags"),
  );
  const source = await readFile(join(repository, "bin/release-bundle"), "utf8");
  const launcher = source.split("<<'LAUNCHER'\n")[1]?.split("\nLAUNCHER")[0];
  if (launcher === undefined) throw new Error("release launcher template missing");
  await writeFile(join(release, "bin/kb"), launcher + "\n", { mode: 0o700 });
  await writeFile(
    join(scratch, "nix-kb"),
    '#!/bin/sh\nset -eu\nKB_PKG_ROOT="$KB_FIXTURE_RELEASE_ROOT/lib/kb"\nexport KB_PKG_ROOT\nexec "$KB_PKG_ROOT/launch" "$KB_BUN" "$KB_PKG_ROOT/launch-flags" "$KB_PKG_ROOT/cli.js" "$@"\n',
    { mode: 0o700 },
  );
});
afterAll(() => rm(scratch, { recursive: true, force: true }));
interface Fixture {
  root: string;
  marker: string;
  env: Record<string, string | undefined>;
}
async function fixture(name: string): Promise<Fixture> {
  const root = join(scratch, name);
  const marker = join(root, "preload-ran");
  await mkdir(root);
  await writeTrustedExtension(
    root,
    "bootstrap.ts",
    extensionModule("bootstrap", {
      actions:
        '[{id:"probe",title:"Bootstrap probe",description:"Synthetic startup contract",mode:{kind:"read"},inputSchema:{parse:x=>x},outputSchema:{parse:x=>x},handler:async()=>({sentinel:process.env.KB_BOOTSTRAP_SENTINEL ?? null})}]',
    }),
  );
  await writeFile(
    join(root, ".env"),
    `KB_BOOTSTRAP_SENTINEL=from-untrusted-root\nKB_DATA=${JSON.stringify(join(root, "forged-data"))}\n`,
  );
  await writeFile(join(root, "bunfig.toml"), 'preload = ["./preload.ts"]\n');
  await writeFile(
    join(root, "preload.ts"),
    `import {writeFileSync} from "node:fs";writeFileSync(${JSON.stringify(marker)},"ran");`,
  );
  const env: Record<string, string | undefined> = {
    ...process.env,
    KB_BUN: process.execPath,
    KB_FIXTURE_RELEASE_ROOT: release,
    KB_HOME: join(root, "home"),
  };
  const optionsPreload = join(scratch, `options-${name.replaceAll(" ", "-")}.ts`);
  await writeFile(
    optionsPreload,
    `import {writeFileSync} from "node:fs";writeFileSync(${JSON.stringify(marker)},"BUN_OPTIONS ran");`,
  );
  env.BUN_OPTIONS = `--preload ${JSON.stringify(optionsPreload)}`;
  delete env.KB_BOOTSTRAP_SENTINEL;
  return { root, marker, env };
}
async function run(command: readonly string[], on: Fixture) {
  const child = Bun.spawn([...command], {
    cwd: on.root,
    env: on.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, error] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exit: await child.exited, out, error };
}
describe("KB startup contract", () => {
  const adapters = [
    "checkout",
    "release",
    "nix",
    ...(process.env.KB_NIX_TEST_BIN === undefined ? [] : ["built nix artifact"]),
  ] as const;
  for (const adapter of adapters) {
    test(`${adapter}: repository dotenv and bunfig preload cannot configure kb`, async () => {
      const on = await fixture(adapter);
      const executable =
        adapter === "checkout"
          ? KB_SOURCE_BIN
          : adapter === "release"
            ? join(release, "bin/kb")
            : adapter === "nix"
              ? join(scratch, "nix-kb")
              : (process.env.KB_NIX_TEST_BIN ?? "missing-nix-test-artifact");
      const result = await run(
        [
          executable,
          "--root",
          on.root,
          "--json",
          "action-invoke",
          JSON.stringify({ id: "ext.bootstrap.probe", input: {} }),
        ],
        on,
      );
      expect(result.exit, result.error).toBe(0);
      expect(JSON.parse(result.out)).toMatchObject({
        status: "succeeded",
        output: { sentinel: null },
      });
      expect(await Bun.file(on.marker).exists()).toBe(false);
    });
  }
  test("the hostile cwd really autoloads dotenv and a preload without the launch contract", async () => {
    const on = await fixture("unsafe-probe");
    delete on.env.KB_DATA;
    const probe = join(on.root, "benign-probe.ts");
    await writeFile(
      probe,
      "console.log(JSON.stringify({sentinel:process.env.KB_BOOTSTRAP_SENTINEL ?? null,data:process.env.KB_DATA}));",
    );
    const result = await run([process.execPath, probe], on);
    expect(result.exit, result.error).toBe(0);
    expect(JSON.parse(result.out)).toEqual({
      sentinel: "from-untrusted-root",
      data: join(on.root, "forged-data"),
    });
    expect(await Bun.file(on.marker).exists()).toBe(true);
  });
  test("the importable program waits for main before running the CLI", async () => {
    const on = await fixture("importable-program");
    const entry = join(release, "lib/kb/program.js");
    const probe = join(scratch, "program-probe.mjs");
    await writeFile(
      probe,
      `const program = await import(${JSON.stringify(entry)});
console.log("loaded");
console.log("status=" + await program.main([process.execPath, ${JSON.stringify(entry)}, "--version"]));
`,
    );
    const flags = (await readFile(join(release, "lib/kb/launch-flags"), "utf8")).trim().split("\n");
    const result = await run([process.execPath, ...flags, probe], on);
    expect(result.exit, result.error).toBe(0);
    expect(result.out.trim().split("\n")).toEqual([
      "loaded",
      expect.stringMatching(/^\d+\.\d+\.\d+/),
      "status=0",
    ]);
    expect(await Bun.file(join(on.root, ".kb", "nodes.jsonl")).exists()).toBe(false);
  });
  test("the packaged server keeps executing and serving its captured artifacts after disk replacement", async () => {
    const on = await fixture("held-packaged-server");
    const lib = join(release, "lib/kb");
    const paths = [
      "program.js",
      "packages/app/ui/dist/index.html",
      "packages/app/ui/dist/static/lazy.js",
      "packages/app/ui/dist/static/worker.js",
    ];
    const originals = await Promise.all(
      paths.map(async (path) => ({ path, bytes: await readFile(join(lib, path)) })),
    );
    const child = Bun.spawn(
      [join(release, "bin/kb"), "--root", on.root, "ui", "--port", "0", "--no-open"],
      {
        cwd: on.root,
        env: on.env,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "pipe",
      },
    );
    const timeout = setTimeout(() => child.kill(), 10_000);
    const reader = child.stderr.getReader();
    try {
      let log = "";
      let address: string | undefined;
      while (address === undefined) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error(`packaged server stopped before listening: ${log}`);
        log += new TextDecoder().decode(chunk.value);
        address = /kb ui listening on (http:\/\/[^;\s]+)/.exec(log)?.[1];
      }
      clearTimeout(timeout);
      for (const path of paths)
        await writeFile(join(lib, path), 'throw new Error("disk replacement")');
      await writeFile(join(lib, "packages/app/ui/dist/static/unheld.js"), "unheld disk module");
      const index = await fetch(address);
      expect(await index.text()).toBe("startup fixture");
      expect(index.headers.get("ETag")).toMatch(/^"sha256:/);
      expect(await (await fetch(new URL("/static/lazy.js", address))).text()).toBe(
        "held lazy module",
      );
      expect(await (await fetch(new URL("/static/worker.js", address))).text()).toBe("held worker");
      expect((await fetch(new URL("/static/unheld.js", address))).status).toBe(404);
      expect((await fetch(new URL("/api/identity", address))).status).toBe(200);
    } finally {
      clearTimeout(timeout);
      child.kill();
      await child.exited;
      reader.releaseLock();
      await Promise.all(originals.map(({ path, bytes }) => writeFile(join(lib, path), bytes)));
      await rm(join(lib, "packages/app/ui/dist/static/unheld.js"), { force: true });
    }
  }, 15_000);
  test("raw cli.js with an extra preload flag exits 78 before opening the root", async () => {
    const on = await fixture("extra-startup-flag");
    const preload = join(on.root, "explicit-preload.ts");
    await writeFile(preload, "export const harmless=true;\n");
    const flags = (await readFile(join(release, "lib/kb/launch-flags"), "utf8")).trim().split("\n");
    const result = await run(
      [
        process.execPath,
        ...flags,
        "--preload",
        preload,
        join(release, "lib/kb/cli.js"),
        "--root",
        on.root,
        "--json",
        "ext",
        "list",
      ],
      on,
    );
    expect(result.exit).toBe(78);
    expect(result.error).toContain("unsafe Bun launch");
    expect(await Bun.file(join(on.root, ".kb", "nodes.jsonl")).exists()).toBe(false);
  });
  test("raw cli.js without launch flags exits 78 before opening the root", async () => {
    const on = await fixture("unprotected-entry");
    await rm(join(on.root, "bunfig.toml"));
    const result = await run(
      [
        process.execPath,
        join(release, "lib/kb/cli.js"),
        "--root",
        on.root,
        "--json",
        "ext",
        "list",
      ],
      on,
    );
    expect(result.exit).toBe(78);
    expect(result.error).toContain("unsafe Bun launch");
    expect(result.error).toContain("--no-env-file --config=/dev/null");
    expect(await Bun.file(join(on.root, ".kb", "nodes.jsonl")).exists()).toBe(false);
  });
});
