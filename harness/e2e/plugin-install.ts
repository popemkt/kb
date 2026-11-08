/** On-demand public-GitHub acceptance. All stores, homes, data and sample changes are synthetic. */
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { strict as assert } from "node:assert";

const repository = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), "kb-install-acceptance-"));
const data = join(scratch, "data");
const rootA = join(scratch, "a");
const rootB = join(scratch, "b");
const rootC = join(scratch, "c");
const sample = join(scratch, "sample");
const tools = join(scratch, "tools");
const fetchLog = join(scratch, "fetches");
for (const path of [rootA, rootB, rootC, tools]) await mkdir(path);
await writeFile(fetchLog, "");
const git = Bun.which("git");
if (git === null) throw new Error("git is required");
const gitExecutable = git;
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
const branch = `kb-acceptance-${Date.now()}`;
async function sampleGit(args: string[], cwd = sample) {
  const child = Bun.spawn([gitExecutable, ...args], {
    cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, error] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  assert.equal(await child.exited, 0, error);
  return out.trim();
}
function sampleHello(revision: number): string {
  return `import {ActionPoint,Effect,defineExtension,definePlugin,extensionNamespace,provideAction} from "kb-ext-sdk";
import {z} from "zod";
export const declaration=defineExtension({name:"hello",label:"Hello sample",seed:at=>[{id:"hello.sample",text:"Synthetic sample node",props:{},children:[],createdAt:at,updatedAt:at}]});
export default definePlugin({name:declaration.name,namespace:extensionNamespace(declaration.name),apply:ctx=>Effect.all([
 ctx.contribute(ActionPoint,provideAction({id:"greet",title:"Say hello",description:"Synthetic acceptance greeting",mode:{kind:"read"},inputSchema:z.object({name:z.string()}),outputSchema:z.string(),effect:({name})=>Effect.succeed("hello, "+name)})),
 ctx.contribute(ActionPoint,provideAction({id:"revision",title:"Sample revision",description:"Synthetic acceptance revision",mode:{kind:"read"},inputSchema:z.object({}),outputSchema:z.number(),effect:()=>Effect.succeed(${revision})})),
],{discard:true})});\n`;
}
async function pushRevision(revision: number) {
  await writeFile(join(sample, "extensions", "hello", "hello.ts"), sampleHello(revision));
  await sampleGit(["add", "extensions/hello/hello.ts"]);
  await sampleGit([
    "-c",
    "user.name=kb acceptance",
    "-c",
    "user.email=acceptance@example.invalid",
    "commit",
    "-m",
    `Synthetic acceptance revision ${revision}`,
  ]);
  await sampleGit(["push", "origin", `HEAD:refs/heads/${branch}`]);
  return await sampleGit(["rev-parse", "HEAD"]);
}
const command = (root: string, args: string[]) => [
  join(repository, "bin/kb"),
  "--root",
  root,
  "--json",
  ...args,
];
async function receipt(root: string, args: string[]) {
  const child = Bun.spawn(command(root, args), {
    cwd: root,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [text, errors] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  assert.ok(text.trim() !== "", `no receipt for ${JSON.stringify(args)}: ${errors}`);
  const result = JSON.parse(text) as { status: string; code?: string; output: unknown };
  assert.equal(await child.exited, result.status === "succeeded" ? 0 : 1, errors || text);
  const log =
    args[0] === "ext" && args[1] === "list"
      ? {
          ...result,
          output: {
            extensions: (result.output as { extensions: Row[] }).extensions.filter(
              (row) => row.origin !== undefined,
            ),
          },
        }
      : result;
  console.log(JSON.stringify({ command: args, receipt: log }));
  return result;
}
async function kb(root: string, args: string[]) {
  const result = await receipt(root, args);
  assert.equal(result.status, "succeeded", JSON.stringify(result));
  return result.output;
}
interface Row {
  name: string;
  source: string;
  digest?: string;
  files?: string;
  trusted?: boolean;
  enabled: boolean;
  shadowed?: string;
  running?: { digest: string };
  origin?: { kind: string };
  reach?: { page: boolean };
}
async function listed(root: string, name: string) {
  const output = (await kb(root, ["ext", "list"])) as { extensions: Row[] };
  const row = output.extensions.find(
    (candidate) => candidate.name === name && candidate.shadowed === undefined,
  );
  assert.ok(row, `missing ${name}`);
  return row;
}
async function ttyTrust(root: string, name: string) {
  let output = "";
  let answered = false;
  const child = Bun.spawn(command(root, ["ext", "trust", name]), {
    cwd: root,
    env,
    terminal: {
      cols: 140,
      rows: 40,
      data(terminal, bytes) {
        output += new TextDecoder().decode(bytes);
        if (!answered && output.includes("[y/N]")) {
          answered = true;
          terminal.write("y\n");
        }
      },
    },
  });
  try {
    assert.equal(await child.exited, 0, output);
    assert.ok(answered, "trust never asked");
    assert.ok(output.includes('"trusted": true'));
    console.log(
      JSON.stringify({
        command: ["ext", "trust", name],
        terminal: "owned scratch pty",
        approved: true,
      }),
    );
  } finally {
    child.kill();
    child.terminal?.close();
    await child.exited;
  }
}
async function mcpHasNoTrust() {
  const child = Bun.spawn(command(rootA, ["mcp"]), {
    cwd: rootA,
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  const stream = child.stdout.getReader();
  let held = "";
  async function response(id: number) {
    for (;;) {
      const end = held.indexOf("\n");
      if (end !== -1) {
        const line = held.slice(0, end);
        held = held.slice(end + 1);
        if (line.trim() === "") continue;
        const value = JSON.parse(line) as { id?: number; result?: { tools?: { name: string }[] } };
        if (value.id === id) return value;
        continue;
      }
      const next = await stream.read();
      assert.equal(next.done, false, "MCP closed before responding");
      held += new TextDecoder().decode(next.value);
    }
  }
  const send = (value: unknown) => child.stdin.write(JSON.stringify(value) + "\n");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = (async () => {
      await send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "synthetic-acceptance", version: "1" },
        },
      });
      await response(1);
      await send({ jsonrpc: "2.0", method: "notifications/initialized" });
      await send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      const answer = await response(2);
      assert.ok(answer.result?.tools);
      assert.ok(
        !answer.result.tools.some((tool) =>
          ["sandbox_trust", "sandbox_trust_import"].includes(tool.name),
        ),
      );
    })();
    await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("MCP acceptance timed out")), 15_000);
      }),
    ]);
    console.log(JSON.stringify({ check: "MCP hides approval-required trust tools", passed: true }));
  } finally {
    clearTimeout(timeout);
    child.kill();
    await child.exited;
    await stream.cancel();
    stream.releaseLock();
  }
}
await sampleGit(
  ["clone", "--depth=1", "https://github.com/popemkt/kb-plugins-sample.git", sample],
  scratch,
);
await sampleGit(["checkout", "-b", branch]);
const firstRev = await pushRevision(1);
const source = `github:popemkt/kb-plugins-sample/extensions/hello@${branch}`;
console.log(JSON.stringify({ scratch, branch, firstRev }));
const installed = (await kb(rootA, ["ext", "install", source])) as {
  installed: { name: string; files: string; rev: string; digest: string; trusted: boolean }[];
};
const old = installed.installed[0];
assert.ok(old);
assert.equal(old.trusted, false);
assert.equal(old.rev, firstRev);
const oldTree = join(data, "extensions", "store", `${old.files.slice(7, 39)}-hello`);
assert.equal((await stat(oldTree)).mode & 0o222, 0);
assert.equal((await stat(join(oldTree, "hello.ts"))).mode & 0o222, 0);
assert.equal((await listed(rootA, "hello")).trusted, false);
await mcpHasNoTrust();
assert.equal((await receipt(rootA, ["ext", "trust", "hello"])).code, "approval_required");
assert.equal(await Bun.file(join(data, "trust.json")).exists(), false);
await ttyTrust(rootA, "hello");
assert.equal(
  await kb(rootA, ["action-invoke", JSON.stringify({ id: "ext.hello.revision", input: {} })]),
  1,
);
await kb(rootA, ["ext", "marketplace", "add", `github:popemkt/kb-plugins-sample@${branch}`]);
await kb(rootA, ["ext", "install", "aurora"]);
await ttyTrust(rootA, "aurora");
const lockA = join(rootA, ".kb", "extensions.lock.json");
const lock = JSON.parse(await readFile(lockA, "utf8")) as {
  extensions: { aurora: { original: string } };
  marketplaces: { sample: { locked: { rev: string } } };
};
assert.equal(lock.extensions.aurora.original, "aurora@sample");
// A plugin's backdrop: nothing of it runs or seeds until a person trusts it, then its option and knobs are nodes.
await kb(rootA, ["ext", "install", "tide-backdrop"]);
const tide = await listed(rootA, "tide-backdrop");
assert.equal(tide.trusted, false);
assert.equal(tide.reach?.page, true);
assert.equal((await receipt(rootA, ["get", "sys.backdrop.tide-backdrop.tide"])).code, "not_found");
await ttyTrust(rootA, "tide-backdrop");
for (const id of ["sys.backdrop.tide-backdrop.tide", "sys.backdrop.tide-backdrop.tide.knob.hue"]) {
  assert.ok(JSON.stringify(await kb(rootA, ["get", id])).includes(id));
}
await kb(rootA, ["ext", "remove", "tide-backdrop"]);
assert.ok(
  !((await kb(rootA, ["ext", "list"])) as { extensions: Row[] }).extensions.some(
    (row) => row.name === "tide-backdrop",
  ),
);
assert.equal(lock.marketplaces.sample.locked.rev, firstRev);
const nextRev = await pushRevision(2);
const outdated = (await kb(rootA, ["ext", "outdated"])) as {
  extensions: { name: string; from: string; to: string }[];
};
assert.ok(
  outdated.extensions.some(
    (row) => row.name === "hello" && row.from === firstRev && row.to === nextRev,
  ),
);
await kb(rootA, ["ext", "update"]);
const pending = await listed(rootA, "hello");
assert.notEqual(pending.digest, old.digest);
assert.equal(pending.trusted, false);
assert.equal(pending.running?.digest, old.digest);
assert.equal(
  await kb(rootA, ["action-invoke", JSON.stringify({ id: "ext.hello.revision", input: {} })]),
  1,
);
const diff = (await kb(rootA, ["ext", "diff", "hello"])) as { files: { path: string }[] };
assert.ok(diff.files.some((file) => file.path === "hello.ts"));
await ttyTrust(rootA, "hello");
assert.equal(
  await kb(rootA, [
    "action-invoke",
    JSON.stringify({ id: "ext.hello.greet", input: { name: "kb" } }),
  ]),
  "hello, kb",
);
assert.equal(
  await kb(rootA, ["action-invoke", JSON.stringify({ id: "ext.hello.revision", input: {} })]),
  2,
);
const before = await readFile(fetchLog, "utf8");
await kb(rootB, ["ext", "install", source]);
assert.equal(await readFile(fetchLog, "utf8"), before);
assert.equal((await listed(rootB, "hello")).trusted, true);
assert.equal(
  await kb(rootB, ["action-invoke", JSON.stringify({ id: "ext.hello.revision", input: {} })]),
  2,
);
await kb(rootA, ["ext", "install", "aurora", "--scope", "user"]);
assert.equal((await listed(rootC, "aurora")).trusted, true);
await kb(rootA, [
  "action-invoke",
  JSON.stringify({ id: "location.register", input: { path: rootB } }),
]);
await kb(rootA, ["ext", "remove", "hello"]);
await kb(rootA, ["ext", "gc"]);
assert.equal(await Bun.file(join(oldTree, "hello.ts")).exists(), false); // B names only the new version.
const newTree = join(data, "extensions", "store", `${pending.files?.slice(7, 39)}-hello`);
assert.equal(await Bun.file(join(newTree, "hello.ts")).exists(), true);
await kb(rootB, ["ext", "remove", "hello"]);
await kb(rootA, ["ext", "gc"]);
assert.equal(await Bun.file(join(newTree, "hello.ts")).exists(), false);
const ledger = JSON.parse(await readFile(join(data, "trust.json"), "utf8")) as {
  trusted: { name?: string }[];
};
assert.ok(!ledger.trusted.some((record) => record.name === "hello"));
assert.ok(
  (await readdir(join(data, "extensions", "store"))).some((name) => name.endsWith("-aurora")),
);
assert.ok(JSON.stringify(await kb(rootA, ["get", "hello.sample"])).includes("hello.sample"));
console.log(
  JSON.stringify({
    result: "plugin install acceptance passed",
    scratch,
    branch,
    firstRev,
    nextRev,
    cacheReuse: "zero additional fetches in store B",
    fetches: (await readFile(fetchLog, "utf8")).trim().split("\n").length,
  }),
);
