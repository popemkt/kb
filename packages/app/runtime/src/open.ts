/**
 * Opening a root: the one way every surface gets a session over a root's
 * store. Its own module so that what needs a session over another root (the
 * runtime's `KbRoots` adapter) and the runtime layer over this one both build
 * on it without importing each other.
 */
import { Effect, Exit } from "effect";
import type { FileSystem } from "effect/FileSystem";
import { legacyViewShapes, type DomainError, type KbNode, type SeedRetirement } from "@kb/model";
import { derivedWith, type TextCandidates } from "@kb/query";
import type { KbContext } from "@kb/contracts";
import { readLegacyDocsViews } from "@kb/workspace-fs";
import { sessionOver } from "./own-write.ts";
import { reconcileSessionSchema, sessionSeed } from "./session-schema.ts";
import { selectStore } from "./store-selection.ts";

/**
 * Warn, and only warn, that a store or its root still holds what came before
 * view nodes: the shapes `views.migrate` rewrites and the spec files it
 * imports.
 */
const reportLegacyViews = Effect.fn("kb.open.legacyViews")(function* (
  root: string,
  nodes: KbNode[],
  retirements: readonly SeedRetirement[],
) {
  const files = yield* readLegacyDocsViews(root);
  const held = [
    ...legacyViewShapes(nodes, retirements),
    ...(files.views.length > 0
      ? [`.kb/views spec(s) ${files.views.map((view) => view.name).join(", ")}`]
      : []),
    ...files.skipped,
  ];
  if (held.length > 0)
    yield* Effect.logWarning(
      `kb: ${root} holds shapes from before view nodes; run the views.migrate action: ${held.join("; ")}`,
    );
});

/**
 * Open a session over the root's store.
 *
 * Opening is a read. It writes only when a real migration runs — the
 * system seed adds or retires nodes, a field-type value or a legacy date
 * value is rewritten — and then it
 * commits exactly the nodes that migration changed, never the whole set,
 * as kb's own write (`persistOwnWrite`): the seed is the store's, not the
 * caller's. Ranks
 * are not a migration: a node without one is ordered by `compareRootOrder`
 * in memory and ranked by the store on the next commit that writes its
 * sibling group (DESIGN.md → Sibling ranks), so reopening a store leaves its
 * bytes, its fingerprint and its tail alone.
 *
 * A store written before view nodes, or a root still keeping `.kb/views`
 * specs, is not rewritten here: that is `views.migrate`, an action a person
 * or agent runs. Opening says so, as a warning in the log.
 */
export const openKbEffect = Effect.fn("kb.open")(function* (
  root: string,
  textCandidates?: TextCandidates,
): Effect.fn.Return<KbContext, DomainError, FileSystem> {
  return yield* Effect.acquireUseRelease(
    selectStore(root),
    (store) =>
      Effect.gen(function* () {
        // Before the load: see `noteStoreSynced`.
        const fingerprint = yield* store.fingerprint;
        const loaded = yield* store.loadEffect;
        const ctx = yield* sessionOver(
          root,
          store,
          { nodes: loaded, fingerprint },
          derivedWith({}),
          textCandidates,
        );
        yield* reconcileSessionSchema(ctx);
        yield* reportLegacyViews(root, ctx.nodes, sessionSeed(ctx).retired);
        return ctx;
      }),
    (store, exit) => (Exit.isFailure(exit) ? store.closeEffect : Effect.void),
  );
});

/** Open a session whose store is released with the caller's scope. */
export const openKbScoped = Effect.fn("kb.openScoped")(function* (
  root: string,
  textCandidates?: TextCandidates,
) {
  return yield* Effect.acquireRelease(
    openKbEffect(root, textCandidates),
    (ctx) => ctx.store.closeEffect,
  );
});
