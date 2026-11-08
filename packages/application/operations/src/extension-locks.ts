/** Source selections are prepared from a snapshot, then compared under the publication lock. */
import { Effect } from "effect";
import {
  ExtensionStorage,
  EXTENSION_SCOPES,
  type ExtensionLock,
  type ExtensionScope,
  type ExtensionTransaction,
} from "@kb/contracts";
import { canonicalJson, domainError, ensureDomainError } from "@kb/model";
export type SourceSelections = Pick<ExtensionLock, "extensions" | "marketplaces">;
export interface SelectionSnapshot {
  readonly scope: ExtensionScope;
  readonly selections: SourceSelections;
}
export const readSelectionSnapshot = Effect.fn("extensions.readSelectionSnapshot")(function* (
  root: string,
) {
  const storage = yield* ExtensionStorage;
  const result: SelectionSnapshot[] = [];
  for (const scope of EXTENSION_SCOPES) {
    const { lock } = yield* storage.read(root, scope);
    result.push({
      scope,
      selections: { extensions: lock.extensions, marketplaces: lock.marketplaces },
    });
  }
  return result;
});
function requireSelections(actual: SourceSelections, expected: SourceSelections): void {
  if (
    canonicalJson(actual.extensions) !== canonicalJson(expected.extensions) ||
    canonicalJson(actual.marketplaces) !== canonicalJson(expected.marketplaces)
  )
    throw domainError(
      "conflict",
      "extension source selections changed while fetching; retry the operation",
    );
}
export const checkSelectionSnapshot = Effect.fn("extensions.checkSelectionSnapshot")(function* (
  root: string,
  expected: readonly SelectionSnapshot[],
) {
  const actual = yield* readSelectionSnapshot(root);
  return yield* Effect.try({
    try: () => {
      for (const entry of expected) {
        const held = actual.find((row) => row.scope === entry.scope);
        if (held === undefined) throw domainError("conflict", "extension scope disappeared");
        requireSelections(held.selections, entry.selections);
      }
    },
    catch: ensureDomainError,
  });
});
export const writeSelectionSnapshot = Effect.fn("extensions.writeSelectionSnapshot")(function* (
  tx: ExtensionTransaction,
  root: string,
  before: SelectionSnapshot,
  after: SourceSelections,
) {
  yield* tx.update(root, before.scope, (held) => {
    requireSelections(held, before.selections);
    return { ...held, ...after };
  });
});
