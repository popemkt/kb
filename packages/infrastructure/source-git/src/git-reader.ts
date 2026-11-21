/** The git reader itself: loaded with a source's first fetch (`gitSourceReader`). */
import { Effect } from "effect";
import {
  SourceError,
  SourceReader,
  selectedPaths,
  checkedTree,
  pinnedSchema,
  pinSource,
  type GithubSource,
  type PinnedSource,
} from "@kb/extension-source";
import { checkedSource } from "./checked-source.ts";
import { gitTransport } from "./transport.ts";
import {
  advertisedRefs,
  advertisedCommit,
  ensureTrees,
  withRepository,
  verifyCommit,
} from "./references.ts";
import { readObjects, treeEntries } from "./objects.ts";
/** A reader over git at `base`, which the source's repo names a repository under. */
export function gitReader(base: string): SourceReader["Service"] {
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
            [
              "--literal-pathspecs",
              "ls-tree",
              "-r",
              "-z",
              pin.rev,
              "--",
              ...(pin.path === "" ? [] : [pin.path]),
            ],
            dir,
          );
          const entries = yield* Effect.try({
            try: () => selectedPaths(treeEntries(listing), pin.path),
            catch: SourceError.from,
          });
          return yield* checkedTree(yield* readObjects(git, endpoint, dir, entries));
        }),
      );
    }),
  });
}
