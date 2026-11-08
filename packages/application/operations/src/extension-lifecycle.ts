import { Effect } from "effect";
import { z } from "zod";
import { SourceReader, extensionTree } from "@kb/extension-source";
import {
  CodeTrust,
  ExtensionStorage,
  ExtensionCompiler,
  KbCtx,
  KbRoots,
  DEFAULT_EXTENSION_SCOPE,
  EXTENSION_RELOAD,
  ExtensionScopeSchema,
  ExtensionNameSchema,
  type ActionDefinition,
  type ExtensionTransaction,
  type ExtensionSelection,
} from "@kb/contracts";
import { domainError } from "@kb/model";
import {
  extensionPlan,
  resolveRecordedRequest,
  sourceFailure,
  namedEntries,
} from "./extension-plans.ts";
import {
  readSelectionSnapshot,
  checkSelectionSnapshot,
  writeSelectionSnapshot,
} from "./extension-locks.ts";
import { changedFiles } from "./source-diff.ts";

const NamedScope = z.object({
  name: ExtensionNameSchema.optional(),
  scope: ExtensionScopeSchema.optional(),
});
const Change = z.object({
  name: z.string(),
  scope: ExtensionScopeSchema,
  from: z.string(),
  to: z.string(),
  files: z.array(z.string()),
  digest: z.string().optional(),
  trusted: z.boolean().optional(),
  review: z.string().optional(),
});
export const extensionOutdatedDef = {
  id: "extension.outdated",
  title: "Check extension updates",
  description:
    "Re-resolve original sources, including marketplace indexes, and report changed files. Changes no cache, locks or trust.",
  mode: { kind: "read", outsideRoot: true } as const,
  inputSchema: z.object({ name: ExtensionNameSchema.optional() }),
  outputSchema: z.object({ extensions: z.array(Change) }),
} satisfies ActionDefinition;
export const extensionOutdatedEffect = Effect.fn("extension.outdated")(function* (
  input: z.infer<typeof extensionOutdatedDef.inputSchema>,
) {
  const storage = yield* ExtensionStorage;
  const reader = yield* SourceReader;
  const { root } = yield* KbCtx;
  const extensions: z.infer<typeof Change>[] = [];
  const snapshot = yield* readSelectionSnapshot(root);
  for (const { scope, selections: lock } of snapshot) {
    for (const [name, entry] of namedEntries(lock.extensions, input.name)) {
      const request = yield* resolveRecordedRequest(entry.original, snapshot, scope, lock);
      const before = yield* storage.tree({ kind: "extension", name, files: entry.locked.files });
      const source = yield* reader.read(request.pin).pipe(
        Effect.flatMap((tree) => extensionTree(tree, { name })),
        Effect.mapError(sourceFailure),
      );
      extensions.push({
        name,
        scope,
        from: entry.locked.rev,
        to: request.pin.rev,
        files: changedFiles(before?.source.files ?? [], source.files).map(({ path }) => path),
      });
    }
  }
  if (input.name !== undefined && extensions.length === 0)
    return yield* domainError("not_found", `no installed extension named ${input.name}`);
  return { extensions };
});
export const extensionUpdateDef = {
  id: "extension.update",
  title: "Update extensions",
  description:
    "Explicitly refresh selected sources and marketplaces. With no name update every entry in the scopes in effect. New bytes remain untrusted; the previous approved source keeps running until replacement approval.",
  mode: { kind: "write", outsideRoot: true } as const,
  inputSchema: NamedScope,
  outputSchema: z.object({ updated: z.array(Change), reload: z.literal(EXTENSION_RELOAD) }),
} satisfies ActionDefinition;
export const extensionUpdateEffect = Effect.fn("extension.update")(function* (
  input: z.infer<typeof extensionUpdateDef.inputSchema>,
) {
  const storage = yield* ExtensionStorage;
  const compiler = yield* ExtensionCompiler;
  const trust = yield* CodeTrust;
  const { root } = yield* KbCtx;
  const snapshot = yield* readSelectionSnapshot(root);
  const updated: z.infer<typeof Change>[] = [];
  const prepared: {
    before: (typeof snapshot)[number];
    plans: {
      name: string;
      entry: ExtensionSelection;
      request: Effect.Success<ReturnType<typeof resolveRecordedRequest>>;
      plan: Effect.Success<ReturnType<typeof extensionPlan>>;
    }[];
  }[] = [];
  for (const before of snapshot.filter(
    (entry) => input.scope === undefined || entry.scope === input.scope,
  )) {
    const plans: (typeof prepared)[number]["plans"] = [];
    for (const [name, entry] of namedEntries(before.selections.extensions, input.name)) {
      const request = yield* resolveRecordedRequest(
        entry.original,
        snapshot,
        before.scope,
        before.selections,
      );
      const plan = yield* extensionPlan(request.pin, { name });
      plans.push({ name, entry, request, plan });
    }
    if (plans.length > 0)
      prepared.push({
        before,
        plans,
      });
  }
  if (input.name !== undefined && prepared.length === 0)
    return yield* domainError("not_found", `no installed extension named ${input.name}`);
  return yield* storage.mutate(
    Effect.fn("extension.update.write")(function* (tx: ExtensionTransaction) {
      yield* checkSelectionSnapshot(root, snapshot);
      for (const group of prepared) {
        const extensions = new Map(Object.entries(group.before.selections.extensions));
        const marketplaces = new Map(Object.entries(group.before.selections.marketplaces));
        for (const { name, entry, request, plan } of group.plans) {
          const previousTree = yield* storage.tree({
            kind: "extension",
            name,
            files: entry.locked.files,
          });
          let previous = entry.previous;
          if (previousTree !== null) {
            const digest = yield* compiler.compile(previousTree.dir, name);
            if ((yield* trust.trusted([digest])).includes(digest)) previous = entry.locked;
          }
          const tree = yield* tx.store({ kind: "extension", pin: request.pin }, plan.source);
          const digest = yield* compiler.compile(tree.dir, name);
          if (request.marketplace !== undefined) {
            yield* tx.store(
              { kind: "marketplace", pin: request.marketplace.selection.locked },
              request.marketplace.source,
            );
            marketplaces.set(request.marketplace.name, request.marketplace.selection);
          }
          const next: ExtensionSelection = {
            original: request.original,
            locked: { ...request.pin, files: tree.files },
            ...(previous === undefined || previous.files === tree.files ? {} : { previous }),
          };
          extensions.set(name, next);
          updated.push({
            name,
            scope: group.before.scope,
            from: entry.locked.rev,
            to: request.pin.rev,
            files: changedFiles(previousTree?.source.files ?? [], plan.source.files).map(
              ({ path }) => path,
            ),
            digest,
            trusted: yield* trust.attachSource(digest, { name, files: tree.files }),
            review: `kb ext trust ${name}`,
          });
        }
        yield* writeSelectionSnapshot(tx, root, group.before, {
          extensions: Object.fromEntries(extensions),
          marketplaces: Object.fromEntries(marketplaces),
        });
      }
      return { updated, reload: EXTENSION_RELOAD };
    }),
  );
});
export const extensionRemoveDef = {
  id: "extension.remove",
  title: "Remove an extension selection",
  description:
    "Remove a scope's lock entry. Cached sources, trust and seeded nodes remain until explicit collection.",
  mode: { kind: "write", outsideRoot: true } as const,
  inputSchema: z.object({ name: ExtensionNameSchema, scope: ExtensionScopeSchema.optional() }),
  outputSchema: z.object({ name: z.string(), scope: ExtensionScopeSchema }),
} satisfies ActionDefinition;
export const extensionRemoveEffect = Effect.fn("extension.remove")(function* (
  input: z.infer<typeof extensionRemoveDef.inputSchema>,
) {
  const storage = yield* ExtensionStorage;
  const { root } = yield* KbCtx;
  const scope = input.scope ?? DEFAULT_EXTENSION_SCOPE;
  yield* storage.mutate((tx) =>
    tx.update(root, scope, (held) => ({
      ...held,
      extensions: Object.fromEntries(
        Object.entries(held.extensions).filter(([name]) => name !== input.name),
      ),
    })),
  );
  return { name: input.name, scope };
});

const LinkInput = z.object({ path: z.string().min(1), scope: ExtensionScopeSchema.optional() });
const LinkOutput = z.object({ path: z.string(), scope: ExtensionScopeSchema, notice: z.string() });
export const extensionLinkDef = {
  id: "extension.link",
  title: "Link an extension folder",
  description:
    "Enable a folder through a scope lock. Store links must stay inside this repo. Shared trust enables code already approved on this machine.",
  mode: { kind: "write", outsideRoot: true } as const,
  inputSchema: LinkInput,
  outputSchema: LinkOutput,
} satisfies ActionDefinition;
export const extensionLinkEffect = Effect.fn("extension.link")(function* (
  input: z.infer<typeof LinkInput>,
) {
  const { root } = yield* KbCtx;
  const storage = yield* ExtensionStorage;
  const scope = input.scope ?? DEFAULT_EXTENSION_SCOPE;
  const path = yield* storage.mutate((tx) => tx.links(root, scope, { add: input.path }));
  return {
    path,
    scope,
    notice:
      "Linking enables every extension in this folder already trusted on this machine; new bytes remain untrusted.",
  };
});
export const extensionUnlinkDef = {
  id: "extension.unlink",
  title: "Unlink an extension folder",
  description: "Remove a folder selection from a scope lock. Source files and seeded nodes remain.",
  mode: { kind: "write", outsideRoot: true } as const,
  inputSchema: LinkInput,
  outputSchema: LinkOutput,
} satisfies ActionDefinition;
export const extensionUnlinkEffect = Effect.fn("extension.unlink")(function* (
  input: z.infer<typeof LinkInput>,
) {
  const { root } = yield* KbCtx;
  const storage = yield* ExtensionStorage;
  const scope = input.scope ?? DEFAULT_EXTENSION_SCOPE;
  const path = yield* storage.mutate((tx) => tx.links(root, scope, { remove: input.path }));
  return { path, scope, notice: "Folder unlinked; source files, trust and seeded nodes remain." };
});

export const extensionGcDef = {
  id: "extension.gc",
  title: "Collect unused extension sources",
  description:
    "Keep every candidate, previous and marketplace source named by the user lock, registered locations or any valid private local lock with an existing root. Retire this machine's unreferenced provenance trust, then remove unused trees, pin indexes and abandoned staging. Never removes nodes or trust without provenance.",
  mode: { kind: "write", outsideRoot: true } as const,
  inputSchema: z.object({}),
  outputSchema: z.object({
    trees: z.array(z.string()),
    stages: z.array(z.string()),
    retained: z.array(z.string()),
    retiredTrust: z.array(
      z.object({ digest: z.string(), name: z.string().optional(), files: z.string().optional() }),
    ),
    orphanedLocalLocks: z.array(z.object({ path: z.string(), root: z.string() })),
  }),
} satisfies ActionDefinition;
export const extensionGcEffect = Effect.fn("extension.gc")(function* () {
  const storage = yield* ExtensionStorage;
  const roots = yield* KbRoots;
  const { root } = yield* KbCtx;
  const trust = yield* CodeTrust;
  const registered = yield* roots.registered;
  const home = yield* roots.home;
  return yield* storage.mutate(
    Effect.fn("extension.gc.write")(function* (tx: ExtensionTransaction) {
      const plan = yield* tx.collection([root, home, ...registered]);
      const retained = [...new Set(plan.retained.map((tree) => tree.files))];
      const retiredTrust = (yield* trust.retain(retained)).map(({ digest, name, files }) => ({
        digest,
        name,
        files,
      }));
      return { ...(yield* plan.sweep), retained, retiredTrust };
    }),
  );
});
