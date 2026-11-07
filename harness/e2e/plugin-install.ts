/** On-demand network acceptance. Never part of verify; every path and record is synthetic. */
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { strict as assert } from "node:assert";

const repository = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), "kb-install-acceptance-"));
const data = join(scratch, "data");
const rootA = join(scratch, "a");
const rootB = join(scratch, "b");
const tools = join(scratch, "tools");
const fetchLog = join(scratch, "fetches");
await mkdir(tools);
await mkdir(rootA);
await mkdir(rootB);
await writeFile(fetchLog, "");
const git = Bun.which("git");
if (git === null) throw new Error("git is required");
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
await writeFile(
  join(tools, "git"),
  `#!/bin/sh\nfor arg in "$@"; do\n  if [ "$arg" = fetch ]; then printf '%s\\n' fetch >> ${quote(fetchLog)}; fi\ndone\nexec ${quote(git)} "$@"\n`,
  { mode: 0o700 },
);
const env = {
  ...process.env,
  KB_HOME: join(scratch, "home"),
  KB_DATA: data,
  KB_CACHE: join(scratch, "cache"),
  NODE_ENV: "test",
  PATH: `${tools}:${process.env.PATH ?? ""}`,
};
async function kb(root: string, args: string[]) {
  const child = Bun.spawn(
    [
      process.execPath,
      join(repository, "packages/app/cli/src/main.ts"),
      "--root",
      root,
      "--json",
      ...args,
    ],
    { cwd: root, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );
  const text = await new Response(child.stdout).text();
  const errors = await new Response(child.stderr).text();
  assert.equal(await child.exited, 0, errors || text);
  const receipt = JSON.parse(text) as { status: string; output: unknown };
  assert.equal(receipt.status, "succeeded", text);
  console.log(JSON.stringify({ command: args, receipt }));
  return receipt.output;
}
const source = "github:popemkt/kb-plugins-sample/extensions/hello@main";
const first = (await kb(rootA, ["ext", "install", source])) as {
  installed: {
    name: string;
    rev: string;
    files: string;
    digest: string;
    trusted: boolean;
    cached: boolean;
  }[];
};
const row = first.installed.at(0);
if (row === undefined) throw new Error("install returned no row");
assert.equal(row.name, "hello");
assert.equal(row.trusted, false);
assert.equal(row.cached, false);
assert.match(row.rev, /^[a-f0-9]{40}$/);
const tree = join(data, "extensions", "store", `${row.files.slice(7, 39)}-hello`);
assert.equal((await stat(tree)).mode & 0o222, 0);
assert.equal((await stat(join(tree, "hello.ts"))).mode & 0o222, 0);
const lock = JSON.parse(await readFile(join(rootA, ".kb", "extensions.lock.json"), "utf8")) as {
  extensions: { hello: { original: string; locked: { rev: string; files: string } } };
};
assert.equal(lock.extensions.hello.original, source);
assert.equal(lock.extensions.hello.locked.rev, row.rev);
assert.equal(lock.extensions.hello.locked.files, row.files);
const listing = (await kb(rootA, ["ext", "list"])) as {
  failures: { file: string; error: string }[];
};
assert.ok(
  listing.failures.some(
    ({ file, error }) =>
      file === "hello.ts" && error.includes(row.digest) && error.includes("not trusted"),
  ),
);
const before = await readFile(fetchLog, "utf8");
const second = (await kb(rootB, ["ext", "install", source])) as typeof first;
const secondRow = second.installed.at(0);
if (secondRow === undefined) throw new Error("second install returned no row");
assert.equal(secondRow.cached, true);
assert.equal(secondRow.files, row.files);
assert.equal(secondRow.digest, row.digest);
assert.equal(await readFile(fetchLog, "utf8"), before);
assert.equal(before.trim().split("\n").length, 2);
console.log(JSON.stringify({ result: "install acceptance passed", scratch, fetches: 2 }));
// GAP [[01M6RTRE3ARGNQ6JEP4NWQ8FJ8]] Marketplace acceptance joins this runner when its actions land.
// GAP [[01M6RTRBA9E2WMJSDPVY9A7YPH]] Update/trust acceptance joins this runner with lifecycle actions.
// GAP [[01M6RTRFDBKDPS8MKVYR9GS61R]] Remove/gc acceptance joins this runner with lifecycle actions.
