/** The runtime owns reconciling a session with its families' folded schema. */
import { Effect, Semaphore } from "effect";
import {
  currentIso,
  foldSeed,
  diffTx,
  ensureSystemSeed,
  migrateDateValues,
  migrateFieldTypeValues,
  type DomainError,
  type FoldedSeed,
  type KbNode,
  type StoreTx,
} from "@kb/model";
import { KbStore, type KbContext, type ExtensionDeclaration } from "@kb/contracts";
import type { FileSystem } from "effect/FileSystem";
import { derivedOf } from "@kb/bundled";
import { reloadEffect } from "@kb/operations";
import { rootFamilies, type RootFamilies } from "./families.ts";
import { persistOwnWrite } from "./own-write.ts";

const applySessionSeed = Effect.fn("kb.applySessionSeed")(function* (
  ctx: KbContext,
  seed: FoldedSeed,
): Effect.fn.Return<void, DomainError> {
  if (migrationOf(ctx.nodes, seed) !== null)
    yield* persistOwnWrite(ctx, (nodes) => Effect.succeed(migrationOf(nodes, seed)));
});

/** Serialize schema transitions for a session; a waiting refresh resolves the latest families. */
const states = new WeakMap<
  KbContext,
  { gate: Semaphore.Semaphore; declarations?: readonly ExtensionDeclaration[] }
>();
export const reconcileSessionSchema = Effect.fn("kb.reconcileSessionSchema")(function* (
  ctx: KbContext,
): Effect.fn.Return<RootFamilies, DomainError, FileSystem> {
  let state = states.get(ctx);
  if (state === undefined) {
    state = { gate: Semaphore.makeUnsafe(1) };
    states.set(ctx, state);
  }
  const held = state;
  return yield* held.gate.withPermits(1)(
    Effect.gen(function* () {
      const families = yield* rootFamilies(ctx.root);
      const { declarations } = families;
      if (held.declarations === declarations) return families;
      yield* reloadEffect(ctx).pipe(Effect.provideService(KbStore, ctx.store));
      yield* applySessionSeed(ctx, foldSeed(declarations, yield* currentIso));
      ctx.index.setDerived(derivedOf(declarations));
      held.declarations = declarations;
      return families;
    }),
  );
});

/**
 * What opening writes to a store holding `nodes`: the system seed's
 * additions and retirements, and field-type and legacy date values
 * rewritten, as the nodes that change; null when nothing does.
 */
function migrationOf(nodes: readonly KbNode[], seed: FoldedSeed): StoreTx | null {
  const { nodes: seeded, seeded: didSeed, deletes } = ensureSystemSeed([...nodes], seed);
  const typed = migrateFieldTypeValues(seeded);
  const dated = migrateDateValues(typed.nodes);
  if (!didSeed && deletes.length === 0 && !typed.changed && !dated.changed) return null;
  return diffTx([...nodes], dated.nodes);
}
