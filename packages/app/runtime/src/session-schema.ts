/** The runtime owns reconciling a session with its families' folded schema. */
import { Effect } from "effect";
import {
  diffTx,
  ensureSystemSeed,
  migrateDateValues,
  migrateFieldTypeValues,
  type DomainError,
  type FoldedSeed,
  type KbNode,
  type StoreTx,
} from "@kb/model";
import type { KbContext } from "@kb/contracts";
import { persistOwnWrite } from "./own-write.ts";

export const applySessionSeed = Effect.fn("kb.applySessionSeed")(function* (
  ctx: KbContext,
  seed: FoldedSeed,
): Effect.fn.Return<void, DomainError> {
  if (migrationOf(ctx.nodes, seed) !== null)
    yield* persistOwnWrite(ctx, (nodes) => Effect.succeed(migrationOf(nodes, seed)));
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
