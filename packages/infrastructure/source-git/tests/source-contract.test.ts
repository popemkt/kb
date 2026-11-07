import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit, Result } from "effect";
import {
  checkedTree,
  extensionTree,
  parseSource,
  type SourceReader,
  type ObjectFile,
} from "@kb/extension-source";
import { childProcessEnv } from "@kb/child-process";
import { gitSourceReader, memorySourceReader } from "../src/index.ts";
import { gitTransport } from "../src/transport.ts";
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const scratch = await mkdtemp(join(tmpdir(), "kb-source-contract-"));
const repo = join(scratch, "owner", "repo.git");
await mkdir(repo, { recursive: true });
afterAll(() => rm(scratch, { recursive: true, force: true }));
function git(args: string[], input?: Uint8Array, cwd = repo): string {
  const result = Bun.spawnSync(["git", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    env: childProcessEnv("git", {
      GIT_AUTHOR_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    }),
    stdin: input ?? null,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}
git(["init", "--bare", "--quiet"]);
git(["config", "uploadpack.allowFilter", "true"]);
git(["config", "uploadpack.allowAnySHA1InWant", "true"]);
const revisions = new Map<string, readonly ObjectFile[]>();
const refs = new Map<string, string>();
const parents = new Map<string, readonly string[]>();
const bodies = new Map<string, string>();
function blob(bytes: Uint8Array): string {
  const key = Buffer.from(bytes).toString("base64");
  let oid = bodies.get(key);
  if (oid === undefined) {
    oid = git(["hash-object", "-w", "--stdin"], bytes);
    bodies.set(key, oid);
  }
  return oid;
}
function point(ref: string, rev: string): void {
  git(["update-ref", `refs/heads/${ref}`, rev]);
  refs.set(`refs/heads/${ref}`, rev);
  if (ref === "main") refs.set("HEAD", rev);
}
/** Literal tree objects can exercise names and modes refused by Git's ordinary index. */
function commit(
  files: readonly ObjectFile[],
  ref: string,
  previous: readonly string[] = [],
): string {
  const tree = (entries: readonly ObjectFile[]): string => {
    const groups = new Map<string, ObjectFile[]>();
    const chunks: Buffer[] = [];
    for (const file of entries) {
      const slash = file.path.indexOf("/");
      if (slash !== -1) {
        const name = file.path.slice(0, slash);
        const group = groups.get(name) ?? [];
        group.push({ ...file, path: file.path.slice(slash + 1) });
        groups.set(name, group);
      } else
        chunks.push(
          Buffer.from(`${file.mode} ${file.path}\0`),
          Buffer.from(blob(file.bytes), "hex"),
        );
    }
    for (const [name, group] of groups)
      chunks.push(Buffer.from(`40000 ${name}\0`), Buffer.from(tree(group), "hex"));
    return git(
      ["hash-object", "--literally", "-t", "tree", "-w", "--stdin"],
      Buffer.concat(chunks),
    );
  };
  const rev = git([
    "commit-tree",
    tree(files),
    ...previous.flatMap((parent) => ["-p", parent]),
    "-m",
    ref,
  ]);
  parents.set(rev, previous);
  point(ref, rev);
  revisions.set(rev, files);
  return rev;
}
const file = (path: string, text = "export const value = 42;", mode = "100644"): ObjectFile => ({
  path,
  mode,
  bytes: new TextEncoder().encode(text),
});
const valid = [
  file("hello.ts"),
  file("hello/lib.ts", "export const n = 1;", "100755"),
  file("README.md", "fixture"),
  file("package.json", "{}"),
];
const original = commit(valid, "main");
point("original", original);
git(["symbolic-ref", "HEAD", "refs/heads/main"]);
const hostile = new Map<string, string>();
for (const [name, files] of [
  ["symlink", [file("hello.ts", "outside", "120000")]],
  ["submodule", [file("hello.ts", "outside", "160000")]],
  ["traversal", [file("hello.ts"), file("../escape.ts")]],
  ["absolute", [file("hello.ts"), file("/escape.ts")]],
  ["case", [file("hello.ts"), file("HELLO.ts")]],
  ["directory-case", [file("hello.ts"), file("hello/A/x.ts"), file("hello/a/y.ts")]],
  ["unicode", [file("hello.ts"), file("hello/é.ts"), file("hello/e\u0301.ts")]],
  ["many", [file("hello.ts"), ...Array.from({ length: 512 }, (_, i) => file(`hello/${i}.ts`))]],
  ["big", [file("hello.ts", "x".repeat(8 * 1024 * 1024 + 1))]],
  ["multiple", [file("one.ts"), file("two.ts")]],
  ["deep", [file("hello.ts"), file(`hello/${"part/".repeat(70)}helper.ts`)]],
  ["long-name", [file("hello.ts"), file(`hello/${"x".repeat(256)}.ts`)]],
  ["long-unicode-name", [file("hello.ts"), file(`hello/${"é".repeat(130)}.ts`)]],
] as const)
  hostile.set(name, commit(files, name));
const ancestor = commit([file("hello.ts", "export const value=100;")], "ancestor");
commit(valid, "descendant", [ancestor]);
git(["update-ref", "-d", "refs/heads/ancestor"]);
refs.delete("refs/heads/ancestor");
const tagAncestor = commit([file("hello.ts", "export const value=101;")], "tag-ancestor");
const tagDescendant = commit(valid, "tag-descendant", [tagAncestor]);
git(["tag", "tag-lineage", tagDescendant]);
refs.set("refs/tags/tag-lineage", tagDescendant);
for (const branch of ["tag-ancestor", "tag-descendant"]) {
  git(["update-ref", "-d", `refs/heads/${branch}`]);
  refs.delete(`refs/heads/${branch}`);
}
const fork = join(scratch, "fork", "repo.git");
await mkdir(join(scratch, "fork"));
git(["clone", "--bare", "--quiet", repo, fork]);
git(["config", "uploadpack.allowFilter", "true"], undefined, fork);
git(["config", "uploadpack.allowAnySHA1InWant", "true"], undefined, fork);
const imposter = git(
  ["commit-tree", git(["rev-parse", `${original}^{tree}`]), "-p", original, "-m", "fork-only"],
  undefined,
  fork,
);
git(["update-ref", "refs/heads/fork-only", imposter], undefined, fork);
const forkRefs = new Map([...refs, ["refs/heads/fork-only", imposter]]);
revisions.set(imposter, valid);
parents.set(imposter, [original]);
await writeFile(join(repo, "objects", "info", "alternates"), join(fork, "objects") + "\n");
const networkProbe = join(scratch, "network-probe.git");
git(["init", "--bare", "--quiet", networkProbe]);
// Like GitHub's fork network, the parent URL serves an object owned only by the fork.
git(
  ["fetch", "--quiet", "--filter=blob:none", "--depth=1", `file://${repo}`, imposter],
  undefined,
  networkProbe,
);
const tagTarget = commit([file("hello.ts", "export const value=200;")], "tag-target");
for (const kind of ["light", "annotated"] as const) {
  const name = `collision-${kind}`;
  commit(valid, name);
  git(
    kind === "light"
      ? ["tag", name, tagTarget]
      : ["tag", "-a", name, tagTarget, "-m", "synthetic tag"],
  );
  refs.set(`refs/tags/${name}`, git(["rev-parse", `refs/tags/${name}`]));
  if (kind === "annotated") refs.set(`refs/tags/${name}^{}`, tagTarget);
}
const largeBytes = new Uint8Array(12 * 1024 * 1024);
for (let offset = 0; offset < largeBytes.length; offset += 65536)
  crypto.getRandomValues(largeBytes.subarray(offset, offset + 65536));
const outsideBlob = blob(largeBytes);
const largeRevision = commit(
  [file("ext/hello.ts"), { path: "other/huge.bin", mode: "100644", bytes: largeBytes }],
  "large-path",
);
function sourceContract(name: string, reader: SourceReader["Service"]): void {
  test(`${name}: ancestry may be anchored only by a tag`, async () => {
    expect(
      (await Effect.runPromise(reader.resolve(parseSource(`github:owner/repo@${tagAncestor}`))))
        .rev,
    ).toBe(tagAncestor);
    expect(
      (
        await Effect.runPromise(
          reader
            .read({ repo: "owner/repo", path: "", rev: tagAncestor })
            .pipe(Effect.flatMap(extensionTree)),
        )
      ).name,
    ).toBe("hello");
  });
  test(`${name}: the same object is installable when it names its actual fork`, async () => {
    expect(
      (await Effect.runPromise(reader.resolve(parseSource("github:fork/repo@fork-only")))).rev,
    ).toBe(imposter);
    expect(
      (
        await Effect.runPromise(
          reader
            .read({ repo: "fork/repo", path: "", rev: imposter })
            .pipe(Effect.flatMap(extensionTree)),
        )
      ).name,
    ).toBe("hello");
  });
  test(`${name}: an out-of-path large blob is outside the source budget`, async () => {
    const tree = await Effect.runPromise(
      reader.read({ repo: "owner/repo", path: "ext", rev: largeRevision }),
    );
    expect(tree.files.map(({ path }) => path)).toEqual(["hello.ts"]);
  });
  test(`${name}: proves ancestor commits against the named repository's refs`, async () => {
    expect(
      (await Effect.runPromise(reader.resolve(parseSource(`github:owner/repo@${ancestor}`)))).rev,
    ).toBe(ancestor);
    expect(
      (
        await Effect.runPromise(
          reader
            .read({ repo: "owner/repo", path: "", rev: ancestor })
            .pipe(Effect.flatMap(extensionTree)),
        )
      ).name,
    ).toBe("hello");
  });
  test(`${name}: rejects an accessible object that exists only off the repository's refs`, async () => {
    const resolved = await Effect.runPromise(
      reader.resolve(parseSource(`github:owner/repo@${imposter}`)).pipe(Effect.result),
    );
    expect(Result.isFailure(resolved)).toBe(true);
    if (Result.isFailure(resolved))
      expect(resolved.failure.message).toContain("not reachable from any branch or tag");
    expect(
      Exit.isFailure(
        await Effect.runPromise(
          Effect.exit(reader.read({ repo: "owner/repo", path: "", rev: imposter })),
        ),
      ),
    ).toBe(true);
  });
  test(`${name}: lightweight and annotated tags both take precedence over heads`, async () => {
    for (const kind of ["light", "annotated"])
      expect(
        (
          await Effect.runPromise(
            reader.resolve(parseSource(`github:owner/repo@collision-${kind}`)),
          )
        ).rev,
      ).toBe(tagTarget);
  });
  test(`${name}: resolves refs, reads filtered files, and pins through moving refs`, async () => {
    const source = parseSource("github:owner/repo@main");
    const pinned = await Effect.runPromise(reader.resolve(source));
    expect(pinned).toEqual({ repo: "owner/repo", path: "", rev: original });
    const raw = await Effect.runPromise(reader.read(pinned));
    const read = await Effect.runPromise(extensionTree(raw));
    expect(read.name).toBe("hello");
    expect(read.ignored).toEqual(["package.json"]);
    expect(read.files.map(({ path, mode }) => [path, mode])).toEqual([
      ["README.md", "100644"],
      ["hello.ts", "100644"],
      ["hello/lib.ts", "100755"],
    ]);
    const moved = commit([file("hello.ts", "export const value = 43;")], `moved-${name}`);
    git(["update-ref", "refs/heads/main", moved]);
    refs.set("refs/heads/main", moved);
    expect((await Effect.runPromise(reader.read(pinned))).hash).toBe(raw.hash);
    expect((await Effect.runPromise(reader.resolve(source))).rev).toBe(moved);
    git(["update-ref", "refs/heads/main", original]);
    refs.set("refs/heads/main", original);
  });
  for (const [kind, rev] of hostile)
    test(`${name}: refuses ${kind}`, async () => {
      expect(
        Exit.isFailure(
          await Effect.runPromise(
            Effect.exit(
              reader
                .read({ repo: "owner/repo", path: "", rev })
                .pipe(Effect.flatMap(extensionTree)),
            ),
          ),
        ),
      ).toBe(true);
    });
  for (const path of ["../outside", "/outside", "a/../../outside", "a\\outside"])
    test(`${name}: refuses path ${path}`, async () => {
      expect(
        Exit.isFailure(
          await Effect.runPromise(
            Effect.exit(reader.read({ repo: "owner/repo", path, rev: original })),
          ),
        ),
      ).toBe(true);
    });
  test(`${name}: refuses unknown repositories`, async () => {
    expect(
      Exit.isFailure(
        await Effect.runPromise(
          Effect.exit(reader.read({ repo: "missing/repo", path: "", rev: original })),
        ),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        await Effect.runPromise(
          Effect.exit(reader.resolve({ repo: "missing/repo", path: "", ref: "HEAD" })),
        ),
      ),
    ).toBe(true);
  });
  test(`${name}: refuses abbreviated pins and refs`, async () => {
    expect(
      Exit.isFailure(
        await Effect.runPromise(
          Effect.exit(reader.read({ repo: "owner/repo", path: "", rev: original.slice(0, 12) })),
        ),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        await Effect.runPromise(
          Effect.exit(reader.resolve({ repo: "owner/repo", path: "", ref: original.slice(0, 12) })),
        ),
      ),
    ).toBe(true);
  });
}
const memory = memorySourceReader(
  new Map([
    ["owner/repo", { revisions, refs, parents }],
    ["fork/repo", { revisions, refs: forkRefs, parents }],
  ]),
);
const disk = gitSourceReader(`file://${scratch}`);
sourceContract("memory", memory);
sourceContract("git", disk);
test("file-set hashes agree across adapters", async () => {
  const pin = { repo: "owner/repo", path: "", rev: original };
  expect((await Effect.runPromise(memory.read(pin))).hash).toBe(
    (await Effect.runPromise(disk.read(pin))).hash,
  );
});
test("pasted GitHub URLs normalize and unsafe sources fail", () => {
  expect(parseSource("https://github.com/owner/repo/tree/main/extensions/hello")).toEqual(
    parseSource("github:owner/repo/extensions/hello@main"),
  );
  expect(() => parseSource("github:owner/repo/../escape@main")).toThrow();
  expect(() => parseSource("github:owner/repo@123abcd")).toThrow();
});

test("file-set digest changes with mode or bytes, not source ordering", async () => {
  const first = await Effect.runPromise(checkedTree(valid));
  expect((await Effect.runPromise(checkedTree(valid.toReversed()))).hash).toBe(first.hash);
  expect(
    (
      await Effect.runPromise(
        checkedTree(
          valid.map((entry) => (entry.path === "hello.ts" ? { ...entry, mode: "100755" } : entry)),
        ),
      )
    ).hash,
  ).not.toBe(first.hash);
  expect((await Effect.runPromise(checkedTree([file("hello.ts", "changed")]))).hash).not.toBe(
    first.hash,
  );
});

test("git never downloads the large blob outside the selected path", async () => {
  const real = Bun.which("git");
  if (real === null) throw new Error("git required");
  const tools = join(scratch, "tools");
  const log = join(scratch, "blob-audit");
  const batches = join(scratch, "batch-audit");
  await mkdir(tools);
  await writeFile(
    join(tools, "git"),
    `#!/bin/sh
fetching=0
for arg in "$@"; do
  if [ "$arg" = fetch ]; then fetching=1; fi
  if [ "$arg" = --batch ]; then printf '%s\\n' batch >> ${quote(batches)}; fi
done
${quote(real)} "$@"
status=$?
if [ "$fetching" = 1 ]; then
  if ${quote(real)} cat-file -e ${outsideBlob} >/dev/null 2>&1; then
    printf '%s\\n' present >> ${quote(log)}
  else
    printf '%s\\n' absent >> ${quote(log)}
  fi
fi
exit "$status"
`,
    { mode: 0o700 },
  );
  const previous = process.env.PATH;
  try {
    process.env.PATH = `${tools}:${previous ?? ""}`;
    await Effect.runPromise(
      gitSourceReader(`file://${scratch}`).read({
        repo: "owner/repo",
        path: "ext",
        rev: largeRevision,
      }),
    );
    await Effect.runPromise(
      gitSourceReader(`file://${scratch}`).read({ repo: "owner/repo", path: "", rev: original }),
    );
    const observations = (await readFile(log, "utf8")).trim().split("\n");
    expect(observations).toEqual(["absent", "absent", "absent", "absent"]);
    expect((await readFile(batches, "utf8")).trim().split("\n")).toEqual(["batch", "batch"]);
  } finally {
    if (previous === undefined) delete process.env.PATH;
    else process.env.PATH = previous;
  }
});

test("git's helpers inherit the file budget while downloading objects", async () => {
  const dir = join(scratch, "limited.git");
  const transport = gitTransport(`file://${scratch}`);
  await mkdir(dir);
  await Effect.runPromise(transport(["init", "--bare", "--quiet", "--template=", dir], dir));
  const result = await Effect.runPromise(
    transport(
      ["fetch", "--quiet", "--filter=blob:none", "--no-tags", `file://${repo}`, outsideBlob],
      dir,
      { fileBytes: 64 * 1024 },
    ).pipe(Effect.result),
  );
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) expect(result.failure.message).toContain("transfer limits");
  const packs = join(dir, "objects", "pack");
  for (const name of await readdir(packs))
    expect((await stat(join(packs, name))).size).toBeLessThanOrEqual(64 * 1024);
});

test("caller repository config cannot rewrite source provenance", async () => {
  const caller = join(scratch, "caller");
  await mkdir(caller);
  git(["init", "--quiet", caller]);
  git(["config", `url.file://${fork}.insteadOf`, `file://${repo}`], undefined, caller);
  const previous = process.cwd();
  try {
    process.chdir(caller);
    const reader = gitSourceReader(`file://${scratch}`);
    expect(
      (await Effect.runPromise(reader.resolve(parseSource("github:owner/repo@main")))).rev,
    ).toBe(original);
    expect(
      Exit.isFailure(
        await Effect.runPromise(
          Effect.exit(reader.resolve(parseSource("github:owner/repo@fork-only"))),
        ),
      ),
    ).toBe(true);
  } finally {
    process.chdir(previous);
  }
});

test("an extra object in the client is not repository ancestry, and proofs create no refs", async () => {
  const real = Bun.which("git");
  if (real === null) throw new Error("git required");
  const tools = join(scratch, "extra-object-tools");
  const audit = join(scratch, "proof-ref-audit");
  await mkdir(tools);
  await writeFile(
    join(tools, "git"),
    `#!/bin/sh
fetching=0
for arg in "$@"; do if [ "$arg" = fetch ]; then fetching=1; fi; done
${quote(real)} "$@"
status=$?
if [ "$fetching" = 1 ]; then
  printf '%s\\n' ${quote(join(repo, "objects"))} > objects/info/alternates
  ${quote(real)} for-each-ref --format='%(refname)' >> ${quote(audit)}
fi
exit "$status"
`,
    { mode: 0o700 },
  );
  const previous = process.env.PATH;
  try {
    process.env.PATH = `${tools}:${previous ?? ""}`;
    const result = await Effect.runPromise(
      gitSourceReader(`file://${scratch}`)
        .resolve(parseSource(`github:owner/repo@${imposter}`))
        .pipe(Effect.result),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result))
      expect(result.failure.message).toContain("not reachable from any branch or tag");
    expect(await readFile(audit, "utf8")).toBe("");
  } finally {
    if (previous === undefined) delete process.env.PATH;
    else process.env.PATH = previous;
  }
});
