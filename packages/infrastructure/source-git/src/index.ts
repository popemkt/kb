import { Effect } from "effect";
import {
  SourceError,
  SourceReader,
  selectedPaths,
  checkedTree,
  pinnedSchema,
  pinSource,
  isRepositoryRef,
  type GithubSource,
  type PinnedSource,
  type ObjectFile,
} from "@kb/extension-source";
import { checkedSource } from "./checked-source.ts";

/**
 * The git reader. Endpoints are host configuration; tests inject a
 * directory of bare repositories. Its transport, which runs git, loads
 * with the first fetch, so a command that fetches nothing parses none of it.
 */
export function gitSourceReader(base = "https://github.com"): SourceReader["Service"] {
  const reader = Effect.promise(() => import("./git-reader.ts")).pipe(
    Effect.map(({ gitReader }) => gitReader(base)),
  );
  return SourceReader.of({
    resolve: (source) => Effect.flatMap(reader, (git) => git.resolve(source)),
    read: (source) => Effect.flatMap(reader, (git) => git.read(source)),
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
          return selectedPaths(held, pin.path);
        },
        catch: SourceError.from,
      });
      return yield* checkedTree(files);
    }),
  });
}
