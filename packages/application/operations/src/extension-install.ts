import { Effect } from "effect";
import { z } from "zod";
import type { PinnedSource } from "@kb/extension-source";
import {
  extensionPlan,
  marketplacePlan,
  pinnedMarketplaces,
  resolveExtensionRequest,
  type PinnedMarketplace,
} from "./extension-plans.ts";
import {
  CodeTrust,
  ExtensionCompiler,
  ExtensionStorage,
  KbCtx,
  DEFAULT_EXTENSION_SCOPE,
  EXTENSION_RELOAD,
  ExtensionScopeSchema,
  type ActionDefinition,
  type ExtensionTransaction,
} from "@kb/contracts";
import {
  readSelectionSnapshot,
  checkSelectionSnapshot,
  writeSelectionSnapshot,
} from "./extension-locks.ts";
import { domainError } from "@kb/model";

export const extensionInstallDef = {
  id: "extension.install",
  title: "Install extensions",
  description:
    "Install a GitHub source or marketplace name at a full commit into the shared verified source cache and select it in a lock. With no source, restore missing or tampered trees named by locks. Compiles without importing or trusting; restart running kb ui until live reload is available.",
  mode: { kind: "write", outsideRoot: true } as const,
  inputSchema: z.object({
    source: z.string().min(1).optional(),
    scope: ExtensionScopeSchema.optional(),
  }),
  outputSchema: z.object({
    installed: z.array(
      z.object({
        name: z.string(),
        rev: z.string(),
        files: z.string(),
        digest: z.string(),
        trusted: z.boolean(),
        ignored: z.array(z.string()),
        cached: z.boolean(),
        marketplace: z
          .object({
            name: z.string(),
            scope: ExtensionScopeSchema,
            repo: z.string(),
            path: z.string(),
            rev: z.string(),
            files: z.string(),
          })
          .optional(),
      }),
    ),
    reload: z.literal(EXTENSION_RELOAD),
  }),
} satisfies ActionDefinition;
export const extensionInstallEffect = Effect.fn("extension.install")(function* (
  input: z.infer<typeof extensionInstallDef.inputSchema>,
) {
  const storage = yield* ExtensionStorage;
  const compiler = yield* ExtensionCompiler;
  const trust = yield* CodeTrust;
  const { root } = yield* KbCtx;
  const snapshot = yield* readSelectionSnapshot(root);
  const installed: z.infer<typeof extensionInstallDef.outputSchema>["installed"] = [];
  const record = Effect.fn("extension.install.record")(function* (
    tx: ExtensionTransaction,
    plan: Effect.Success<ReturnType<typeof extensionPlan>>,
    marketplace?: PinnedMarketplace,
  ) {
    const tree = yield* tx.store({ kind: "extension", pin: plan.pin }, plan.source);
    const digest = yield* compiler.compile(tree.dir, tree.name);
    installed.push({
      name: tree.name,
      rev: plan.pin.rev,
      files: tree.files,
      digest,
      trusted: yield* trust.attachSource(digest, { name: tree.name, files: tree.files }),
      ignored: [...plan.source.ignored],
      cached: plan.cached !== null,
      ...(marketplace === undefined
        ? {}
        : {
            marketplace: {
              name: marketplace.name,
              scope: marketplace.scope,
              ...marketplace.selection.locked,
            },
          }),
    });
    return tree;
  });
  if (input.source !== undefined) {
    const request = yield* resolveExtensionRequest(
      input.source,
      input.source.startsWith("github:") || input.source.startsWith("https://github.com/")
        ? []
        : yield* pinnedMarketplaces(snapshot),
    );
    const plan = yield* extensionPlan(
      request.pin,
      request.name === undefined ? undefined : { name: request.name },
    );
    const before = snapshot.find(
      (entry) => entry.scope === (input.scope ?? DEFAULT_EXTENSION_SCOPE),
    );
    if (before === undefined) return yield* domainError("internal", "missing extension scope");
    return yield* storage.mutate(
      Effect.fn("extension.install.write")(function* (tx: ExtensionTransaction) {
        yield* checkSelectionSnapshot(root, snapshot);
        const tree = yield* record(tx, plan, request.marketplace);
        if (request.marketplace !== undefined)
          yield* tx.store(
            { kind: "marketplace", pin: request.marketplace.selection.locked },
            request.marketplace.source,
          );
        yield* writeSelectionSnapshot(tx, root, before, {
          extensions: {
            ...before.selections.extensions,
            [tree.name]: {
              original: request.original,
              locked: { ...request.pin, files: tree.files },
            },
          },
          marketplaces: {
            ...before.selections.marketplaces,
            ...(request.marketplace === undefined
              ? {}
              : { [request.marketplace.name]: request.marketplace.selection }),
          },
        });
        return { installed, reload: EXTENSION_RELOAD };
      }),
    );
  }
  const extensions: Effect.Success<ReturnType<typeof extensionPlan>>[] = [];
  const indexes: { pin: PinnedSource; plan: Effect.Success<ReturnType<typeof marketplacePlan>> }[] =
    [];
  const visited = new Set<string>();
  for (const { selections: lock } of snapshot) {
    for (const [name, entry] of Object.entries(lock.marketplaces)) {
      const present = yield* storage
        .tree({ kind: "marketplace", name, files: entry.locked.files })
        .pipe(Effect.orElseSucceed(() => null));
      if (present !== null) continue;
      const plan = yield* marketplacePlan(entry.locked);
      if (plan.source.name !== name || plan.source.hash !== entry.locked.files)
        return yield* domainError("invalid_input", "fetched marketplace does not match its lock");
      indexes.push({ pin: entry.locked, plan });
    }
    for (const [name, entry] of Object.entries(lock.extensions))
      for (const pin of [entry.locked, ...(entry.previous === undefined ? [] : [entry.previous])]) {
        const key = `${name}\0${pin.files}`;
        if (visited.has(key)) continue;
        visited.add(key);
        const present = yield* storage
          .tree({ kind: "extension", name, files: pin.files })
          .pipe(Effect.orElseSucceed(() => null));
        if (present === null)
          extensions.push(yield* extensionPlan(pin, { name, files: pin.files }));
      }
  }
  return yield* storage.mutate(
    Effect.fn("extension.install.restore")(function* (tx: ExtensionTransaction) {
      yield* checkSelectionSnapshot(root, snapshot);
      for (const { pin, plan } of indexes)
        yield* tx.store({ kind: "marketplace", pin }, plan.source);
      for (const plan of extensions) yield* record(tx, plan);
      return { installed, reload: EXTENSION_RELOAD };
    }),
  );
});
