import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Result } from "effect";
import { fullRev, isRepositoryRef, SourceError, type PinnedSource } from "@kb/extension-source";
import { GIT_BUDGET, type GitTransport } from "./transport.ts";
const decoder = new TextDecoder("utf-8", { fatal: true });
export const advertisedRefs = Effect.fn("source.refs")(function* (
  git: GitTransport,
  url: string,
  dir: string,
) {
  const bytes = yield* git(["ls-remote", url, "HEAD", "refs/heads/*", "refs/tags/*"], dir);
  return yield* Effect.try({
    try: () => {
      const refs = new Map<string, string>();
      for (const line of decoder.decode(bytes).trim().split("\n")) {
        if (line === "") continue;
        const [rev, name] = line.split(/\s+/);
        if (name === undefined) throw new SourceError({ message: "invalid repository refs" });
        refs.set(name, fullRev.parse(rev));
      }
      return refs;
    },
    catch: SourceError.from,
  });
});
/** Heads and peeled tags already identify commits without fetching a history. */
export function advertisedCommit(pin: PinnedSource, refs: ReadonlyMap<string, string>): boolean {
  return [...refs].some(
    ([name, rev]) =>
      rev === pin.rev &&
      (name.startsWith("refs/heads/") || (name.startsWith("refs/tags/") && name.endsWith("^{}"))),
  );
}
const unanchored = (pin: PinnedSource) =>
  new SourceError({
    message: `commit ${pin.rev} is not reachable from any branch or tag of ${pin.repo}`,
  });
const proveAncestry = Effect.fn("source.proveAncestry")(function* (
  git: GitTransport,
  url: string,
  pin: PinnedSource,
  dir: string,
  candidates: readonly string[],
) {
  const tips = [...new Set(candidates)];
  if (tips.length === 0) return false;
  if (tips.length > GIT_BUDGET.refTips)
    return yield* new SourceError({ message: "repository ancestry exceeds the reference budget" });
  // Object wants, not destination refspecs: a hostile ref list cannot create thousands of loose ref files.
  yield* git(
    ["fetch", "--quiet", "--filter=tree:0", "--no-tags", "--no-recurse-submodules", url, ...tips],
    dir,
  );
  const type = yield* git(["cat-file", "-t", pin.rev], dir).pipe(Effect.result);
  if (!Result.isSuccess(type) || decoder.decode(type.success).trim() !== "commit") return false;
  const witness = yield* git(["rev-list", "--ancestry-path", "--max-count=1", "--stdin"], dir, {
    input: new TextEncoder().encode(tips.join("\n") + `\n^${pin.rev}\n`),
    outputBytes: 128,
  });
  return decoder.decode(witness).trim() !== "";
});
export const verifyCommit = Effect.fn("source.verifyCommit")(function* (
  git: GitTransport,
  url: string,
  pin: PinnedSource,
  refs: ReadonlyMap<string, string>,
  dir: string,
) {
  if (![...refs.keys()].some(isRepositoryRef)) return yield* unanchored(pin);
  const direct = [...refs].some(([name, rev]) => isRepositoryRef(name) && rev === pin.rev);
  if (direct) {
    yield* git(
      [
        "fetch",
        "--quiet",
        "--filter=blob:none",
        "--depth=1",
        "--no-tags",
        "--no-recurse-submodules",
        url,
        pin.rev,
      ],
      dir,
    );
    const type = yield* git(["cat-file", "-t", pin.rev], dir).pipe(
      Effect.mapError(() => unanchored(pin)),
    );
    if (decoder.decode(type).trim() !== "commit")
      return yield* new SourceError({ message: `${pin.rev} is not a commit` });
    return { dir, treeReady: true };
  }
  const heads = [...refs].filter(([name]) => name.startsWith("refs/heads/")).map(([, rev]) => rev);
  if (yield* proveAncestry(git, url, pin, dir, heads)) return { dir, treeReady: false };
  const tags = [...refs]
    .filter(([name]) => name.startsWith("refs/tags/") && !name.endsWith("^{}"))
    .map(([name, rev]) => refs.get(`${name}^{}`) ?? rev);
  if (yield* proveAncestry(git, url, pin, dir, tags)) return { dir, treeReady: false };
  return yield* unanchored(pin);
});
/** Every git command, even ref discovery and init, runs outside caller-controlled repositories. */
export function withRepository<A, E, R>(
  git: GitTransport,
  body: (dir: string) => Effect.Effect<A, E, R>,
) {
  return Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => mkdtemp(join(tmpdir(), "kb-source-")),
      catch: SourceError.from,
    }),
    (dir) =>
      git(["init", "--bare", "--quiet", "--template=", dir], dir).pipe(
        Effect.flatMap(() => body(dir)),
      ),
    (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
  );
}
/** A history proof omits trees. Fetch its root tree explicitly, not an already-present commit. */
export const ensureTrees = Effect.fn("source.trees")(function* (
  git: GitTransport,
  url: string,
  pin: PinnedSource,
  repo: { readonly dir: string; readonly treeReady: boolean },
) {
  if (repo.treeReady) return;
  const commit = yield* git(["cat-file", "commit", pin.rev], repo.dir);
  const tree = yield* Effect.try({
    try: () => fullRev.parse(decoder.decode(commit).split("\n", 1)[0]?.slice(5)),
    catch: SourceError.from,
  });
  yield* git(
    ["fetch", "--quiet", "--filter=blob:none", "--no-tags", "--no-recurse-submodules", url, tree],
    repo.dir,
  );
});
