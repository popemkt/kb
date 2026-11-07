import { Effect } from "effect";
import {
  SourceError,
  SourceReader,
  checkedTree,
  parseSource,
  pinnedSchema,
  pinSource,
  isRepositoryRef,
  type GithubSource,
  type PinnedSource,
  type ObjectFile,
} from "@kb/extension-source";
import { gitTransport } from "./transport.ts";
import {
  advertisedRefs,
  advertisedCommit,
  ensureTrees,
  withRepository,
  verifyCommit,
} from "./references.ts";
import { readObjects, treeEntries } from "./objects.ts";
const checkedSource = (source: GithubSource) =>
  parseSource(`github:${source.repo}${source.path === "" ? "" : `/${source.path}`}@${source.ref}`);
/** Endpoints are host configuration; tests inject a directory of bare repositories. */
export function gitSourceReader(base = "https://github.com"): SourceReader["Service"] {
  const git = gitTransport(base);
  const url = (repo: string) => `${base}/${repo}.git`;
  return SourceReader.of({
    resolve: Effect.fn("source.resolve")(function* (source: GithubSource) {
      const valid = yield* Effect.try({
        try: () => checkedSource(source),
        catch: SourceError.from,
      });
      return yield* withRepository(git, (dir) =>
        Effect.gen(function* () {
          const refs = yield* advertisedRefs(git, url(valid.repo), dir);
          const pin = yield* Effect.try({
            try: () => pinSource(valid, refs),
            catch: SourceError.from,
          });
          if (advertisedCommit(pin, refs)) return pin;
          yield* verifyCommit(git, url(pin.repo), pin, refs, dir);
          return pin;
        }),
      );
    }),
    read: Effect.fn("source.read")(function* (source: PinnedSource) {
      const pin = yield* Effect.try({
        try: () => pinnedSchema.parse(source),
        catch: SourceError.from,
      });
      const endpoint = url(pin.repo);
      return yield* withRepository(git, (dir) =>
        Effect.gen(function* () {
          const refs = yield* advertisedRefs(git, endpoint, dir);
          const repo = yield* verifyCommit(git, endpoint, pin, refs, dir);
          yield* ensureTrees(git, endpoint, pin, repo);
          const listing = yield* git(
            ["ls-tree", "-r", "-z", pin.path === "" ? pin.rev : `${pin.rev}:${pin.path}`],
            dir,
          );
          const entries = yield* Effect.try({
            try: () => treeEntries(listing),
            catch: SourceError.from,
          });
          return yield* checkedTree(yield* readObjects(git, endpoint, dir, entries));
        }),
      );
    }),
  });
}
/** Raw object modes and ancestry keep the same adversarial contract as Git. */
export interface MemorySourceRepository {
  readonly revisions: ReadonlyMap<string, readonly ObjectFile[]>;
  readonly refs: ReadonlyMap<string, string>;
  readonly parents: ReadonlyMap<string, readonly string[]>;
}
function reachable(repository: MemorySourceRepository, rev: string): boolean {
  const pending = [...repository.refs]
    .filter(([name]) => isRepositoryRef(name))
    .map(([, referenceRev]) => referenceRev);
  const seen = new Set<string>();
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (candidate === undefined || seen.has(candidate)) continue;
    if (candidate === rev && repository.revisions.has(candidate)) return true;
    seen.add(candidate);
    pending.push(...(repository.parents.get(candidate) ?? []));
  }
  return false;
}
function memoryPin(
  repository: MemorySourceRepository | undefined,
  pin: PinnedSource,
): MemorySourceRepository {
  if (repository === undefined || !reachable(repository, pin.rev))
    throw new SourceError({
      message: `commit ${pin.rev} is not reachable from any branch or tag of ${pin.repo}`,
    });
  return repository;
}
export function memorySourceReader(
  repositories: ReadonlyMap<string, MemorySourceRepository>,
): SourceReader["Service"] {
  return SourceReader.of({
    resolve: Effect.fn("memorySource.resolve")(function* (source: GithubSource) {
      return yield* Effect.try({
        try: () => {
          const valid = checkedSource(source);
          const repository = repositories.get(valid.repo);
          const pin = pinSource(valid, repository?.refs ?? new Map());
          memoryPin(repository, pin);
          return pin;
        },
        catch: SourceError.from,
      });
    }),
    read: Effect.fn("memorySource.read")(function* (source: PinnedSource) {
      const files = yield* Effect.try({
        try: () => {
          const pin = pinnedSchema.parse(source);
          const held = memoryPin(repositories.get(pin.repo), pin).revisions.get(pin.rev);
          if (held === undefined) throw new SourceError({ message: "missing revision" });
          const prefix = pin.path === "" ? "" : `${pin.path}/`;
          return held
            .filter(({ path }) => path.startsWith(prefix))
            .map((file) => ({ ...file, path: file.path.slice(prefix.length) }));
        },
        catch: SourceError.from,
      });
      return yield* checkedTree(files);
    }),
  });
}
