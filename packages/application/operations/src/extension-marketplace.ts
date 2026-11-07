import { Effect, Result } from "effect";
import { z } from "zod";
import { marketplaceTree, MarketplaceIndexSchema } from "@kb/extension-source";
import {
  ExtensionStorage,
  KbCtx,
  DEFAULT_EXTENSION_SCOPE,
  EXTENSION_SCOPES,
  ExtensionScopeSchema,
  ExtensionNameSchema,
  ExtensionSelectionSchema,
  type ActionDefinition,
  type ExtensionTransaction,
} from "@kb/contracts";
import { domainError } from "@kb/model";
import {
  marketplacePlan,
  resolveGithub,
  marketplaceSelections,
  sourceFailure,
  namedEntries,
} from "./extension-plans.ts";

const Changed = z.object({
  name: ExtensionNameSchema,
  scope: ExtensionScopeSchema,
  selection: ExtensionSelectionSchema,
});
const publishMarketplace = Effect.fn("extensions.publishMarketplace")(function* (
  tx: ExtensionTransaction,
  original: string,
  expectedName?: string,
) {
  const pin = yield* resolveGithub(original);
  const plan = yield* marketplacePlan(pin);
  if (expectedName !== undefined && plan.source.name !== expectedName)
    return yield* domainError(
      "invalid_input",
      `marketplace changed name from ${expectedName} to ${plan.source.name}`,
    );
  const tree = plan.cached ?? (yield* tx.store({ kind: "marketplace", pin }, plan.source));
  return {
    name: plan.source.name,
    index: plan.index,
    tree,
    selection: { original, locked: { ...pin, files: tree.files } },
  };
});
export const marketplaceAddDef = {
  id: "extension.marketplace.add",
  title: "Add a marketplace",
  description: "Pin a GitHub marketplace index in a scope. Never imports or trusts its entries.",
  mode: { kind: "write", outsideRoot: true } as const,
  inputSchema: z.object({ source: z.string().min(1), scope: ExtensionScopeSchema.optional() }),
  outputSchema: Changed,
} satisfies ActionDefinition;
export const marketplaceAddEffect = Effect.fn("extension.marketplace.add")(function* (
  input: z.infer<typeof marketplaceAddDef.inputSchema>,
) {
  const storage = yield* ExtensionStorage;
  const { root } = yield* KbCtx;
  const scope = input.scope ?? DEFAULT_EXTENSION_SCOPE;
  return yield* storage.mutate(
    Effect.fn("marketplace.add.write")(function* (tx: ExtensionTransaction) {
      const added = yield* publishMarketplace(tx, input.source);
      yield* tx.update(root, scope, (held) => ({
        ...held,
        marketplaces: { ...held.marketplaces, [added.name]: added.selection },
      }));
      return { name: added.name, scope, selection: added.selection };
    }),
  );
});
export const marketplaceRemoveDef = {
  id: "extension.marketplace.remove",
  title: "Remove a marketplace",
  description: "Remove an index selection; extension locks and cached sources remain.",
  mode: { kind: "write", outsideRoot: true } as const,
  inputSchema: z.object({ name: ExtensionNameSchema, scope: ExtensionScopeSchema.optional() }),
  outputSchema: z.object({ name: z.string(), scope: ExtensionScopeSchema }),
} satisfies ActionDefinition;
export const marketplaceRemoveEffect = Effect.fn("extension.marketplace.remove")(function* (
  input: z.infer<typeof marketplaceRemoveDef.inputSchema>,
) {
  const storage = yield* ExtensionStorage;
  const { root } = yield* KbCtx;
  const scope = input.scope ?? DEFAULT_EXTENSION_SCOPE;
  yield* storage.mutate((tx) =>
    tx.update(root, scope, (held) => ({
      ...held,
      marketplaces: Object.fromEntries(
        Object.entries(held.marketplaces).filter(([name]) => name !== input.name),
      ),
    })),
  );
  return { name: input.name, scope };
});
export const marketplaceUpdateDef = {
  id: "extension.marketplace.update",
  title: "Update marketplace indexes",
  description:
    "Explicitly refresh indexes from their original GitHub sources. With no name refresh every index in the scopes in effect. Does not update or trust extensions.",
  mode: { kind: "write", outsideRoot: true } as const,
  inputSchema: z.object({
    name: ExtensionNameSchema.optional(),
    scope: ExtensionScopeSchema.optional(),
  }),
  outputSchema: z.object({ updated: z.array(Changed) }),
} satisfies ActionDefinition;
export const marketplaceUpdateEffect = Effect.fn("extension.marketplace.update")(function* (
  input: z.infer<typeof marketplaceUpdateDef.inputSchema>,
) {
  const storage = yield* ExtensionStorage;
  const { root } = yield* KbCtx;
  const updated: z.infer<typeof Changed>[] = [];
  return yield* storage.mutate(
    Effect.fn("marketplace.update.write")(function* (tx: ExtensionTransaction) {
      for (const scope of input.scope === undefined ? EXTENSION_SCOPES : [input.scope]) {
        const { lock } = yield* storage.read(root, scope);
        for (const [name, selection] of namedEntries(lock.marketplaces, input.name)) {
          const next = yield* publishMarketplace(tx, selection.original, name);
          yield* tx.update(root, scope, (held) => ({
            ...held,
            marketplaces: { ...held.marketplaces, [name]: next.selection },
          }));
          updated.push({ name, scope, selection: next.selection });
        }
      }
      if (input.name !== undefined && updated.length === 0)
        return yield* domainError("not_found", `no marketplace named ${input.name}`);
      return { updated };
    }),
  );
});
export const marketplaceListDef = {
  id: "extension.marketplace.list",
  title: "List pinned marketplace entries",
  description:
    "Offline list of selected indexes and their entries. Missing or invalid cached indexes are reported without fetching.",
  mode: { kind: "read" } as const,
  inputSchema: z.object({ query: z.string().optional() }),
  outputSchema: z.object({
    marketplaces: z.array(
      Changed.extend({
        entries: MarketplaceIndexSchema.shape.extensions,
        error: z.string().optional(),
      }),
    ),
  }),
} satisfies ActionDefinition;
export const marketplaceListEffect = Effect.fn("extension.marketplace.list")(function* (
  input: z.infer<typeof marketplaceListDef.inputSchema>,
) {
  const { root } = yield* KbCtx;
  const storage = yield* ExtensionStorage;
  const marketplaces: z.infer<typeof marketplaceListDef.outputSchema>["marketplaces"] = [];
  for (const selected of yield* marketplaceSelections(root)) {
    const read = yield* storage
      .tree({ kind: "marketplace", name: selected.name, files: selected.selection.locked.files })
      .pipe(
        Effect.flatMap((tree) =>
          tree === null
            ? domainError("not_found", "index not fetched; run kb ext install")
            : marketplaceTree(tree.source).pipe(Effect.mapError(sourceFailure)),
        ),
        Effect.result,
      );
    if (Result.isFailure(read)) {
      marketplaces.push({ ...selected, entries: [], error: read.failure.message });
      continue;
    }
    const entries = read.success.index.extensions.filter(
      (entry) =>
        input.query === undefined ||
        `${entry.name} ${entry.description ?? ""}`
          .toLowerCase()
          .includes(input.query.toLowerCase()),
    );
    marketplaces.push({ ...selected, entries });
  }
  return { marketplaces };
});
