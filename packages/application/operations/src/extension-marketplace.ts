import { Effect, Result } from "effect";
import { z } from "zod";
import { marketplaceTree, MarketplaceIndexSchema } from "@kb/extension-source";
import {
  ExtensionStorage,
  KbCtx,
  DEFAULT_EXTENSION_SCOPE,
  ExtensionScopeSchema,
  ExtensionNameSchema,
  ExtensionSelectionSchema,
  type ActionDefinition,
  type ExtensionTransaction,
} from "@kb/contracts";
import {
  readSelectionSnapshot,
  checkSelectionSnapshot,
  writeSelectionSnapshot,
  type SourceSelections,
} from "./extension-locks.ts";
import { domainError } from "@kb/model";
import {
  marketplacePlan,
  resolveGithub,
  marketplaceSelections,
  sourceFailure,
  namedEntries,
  marketplaceIdentity,
} from "./extension-plans.ts";

const Changed = z.object({
  name: ExtensionNameSchema,
  scope: ExtensionScopeSchema,
  selection: ExtensionSelectionSchema,
});
const prepareMarketplace = Effect.fn("extensions.prepareMarketplace")(function* (
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
  return {
    ...plan,
    pin,
    name: plan.source.name,
    selection: { original, locked: { ...pin, files: plan.source.hash } },
  };
});
export const marketplaceAddDef = {
  id: "extension.marketplace.add",
  title: "Add a marketplace",
  description: "Pin a GitHub marketplace index in a scope. Never imports or trusts its entries.",
  mode: { kind: "write", outsideRoot: true } as const,
  inputSchema: z.object({
    source: z.string().min(1),
    scope: ExtensionScopeSchema.optional(),
    replace: z
      .boolean()
      .optional()
      .describe("Replace a same-name marketplace from a different repository/path in this scope"),
  }),
  outputSchema: Changed,
} satisfies ActionDefinition;
export const marketplaceAddEffect = Effect.fn("extension.marketplace.add")(function* (
  input: z.infer<typeof marketplaceAddDef.inputSchema>,
) {
  const storage = yield* ExtensionStorage;
  const { root } = yield* KbCtx;
  const scope = input.scope ?? DEFAULT_EXTENSION_SCOPE;
  const snapshot = yield* readSelectionSnapshot(root);
  const added = yield* prepareMarketplace(input.source);
  const before = snapshot.find((entry) => entry.scope === scope);
  if (before === undefined) return yield* domainError("internal", "missing marketplace scope");
  const held = Object.hasOwn(before.selections.marketplaces, added.name)
    ? before.selections.marketplaces[added.name]
    : undefined;
  if (
    held !== undefined &&
    marketplaceIdentity(held) !== marketplaceIdentity(added.selection) &&
    input.replace !== true
  )
    return yield* domainError(
      "invalid_input",
      `marketplace ${added.name} in ${scope} already names ${held.locked.repo}/${held.locked.path}; use --replace to select ${added.selection.locked.repo}/${added.selection.locked.path}`,
    );
  const after = {
    ...before.selections,
    marketplaces: { ...before.selections.marketplaces, [added.name]: added.selection },
  };
  yield* marketplaceSelections(
    snapshot.map((entry) => (entry.scope === scope ? { scope, selections: after } : entry)),
  );
  return yield* storage.mutate(
    Effect.fn("marketplace.add.write")(function* (tx: ExtensionTransaction) {
      yield* checkSelectionSnapshot(root, snapshot);
      yield* tx.store({ kind: "marketplace", pin: added.pin }, added.source);
      yield* writeSelectionSnapshot(tx, root, before, after);
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
  const snapshot = yield* readSelectionSnapshot(root);
  yield* marketplaceSelections(snapshot);
  const prepared: {
    before: (typeof snapshot)[number];
    after: SourceSelections;
    plans: Effect.Success<ReturnType<typeof prepareMarketplace>>[];
  }[] = [];
  const updated: z.infer<typeof Changed>[] = [];
  for (const before of snapshot.filter(
    (entry) => input.scope === undefined || entry.scope === input.scope,
  )) {
    const plans: Effect.Success<ReturnType<typeof prepareMarketplace>>[] = [];
    const marketplaces = new Map(Object.entries(before.selections.marketplaces));
    for (const [name, selection] of namedEntries(before.selections.marketplaces, input.name)) {
      const plan = yield* prepareMarketplace(selection.original, name);
      plans.push(plan);
      marketplaces.set(name, plan.selection);
      updated.push({ name, scope: before.scope, selection: plan.selection });
    }
    if (plans.length > 0)
      prepared.push({
        before,
        after: { ...before.selections, marketplaces: Object.fromEntries(marketplaces) },
        plans,
      });
  }
  if (input.name !== undefined && updated.length === 0)
    return yield* domainError("not_found", `no marketplace named ${input.name}`);
  return yield* storage.mutate(
    Effect.fn("marketplace.update.write")(function* (tx: ExtensionTransaction) {
      yield* checkSelectionSnapshot(root, snapshot);
      for (const { before, after, plans } of prepared) {
        for (const plan of plans)
          yield* tx.store({ kind: "marketplace", pin: plan.pin }, plan.source);
        yield* writeSelectionSnapshot(tx, root, before, after);
      }
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
  for (const selected of yield* marketplaceSelections(yield* readSelectionSnapshot(root))) {
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
