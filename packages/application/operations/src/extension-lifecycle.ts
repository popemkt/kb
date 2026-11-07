import { Effect } from "effect";
import { z } from "zod";
import { SourceReader, extensionTree } from "@kb/extension-source";
import {
  CodeTrust,
  ExtensionStorage,
  ExtensionCompiler,
  KbCtx,
  KbRoots,
  EXTENSION_SCOPES,
  DEFAULT_EXTENSION_SCOPE,
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
  for (const scope of EXTENSION_SCOPES) {
    const { lock } = yield* storage.read(root, scope);
    for (const [name, entry] of namedEntries(lock.extensions, input.name)) {
      const request = yield* resolveRecordedRequest(entry.original, root, scope, lock);
      const before = yield* storage.tree({ kind: "extension", name, files: entry.locked.files });
      const source = yield* reader
        .read(request.pin)
        .pipe(Effect.flatMap(extensionTree), Effect.mapError(sourceFailure));
      if (source.name !== name)
        return yield* domainError(
          "invalid_input",
          `upstream extension changed name from ${name} to ${source.name}`,
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
  outputSchema: z.object({ updated: z.array(Change), reload: z.literal("restart kb ui") }),
} satisfies ActionDefinition;
export const extensionUpdateEffect = Effect.fn("extension.update")(function* (
  input: z.infer<typeof extensionUpdateDef.inputSchema>,
) {
  const storage = yield* ExtensionStorage;
  const compiler = yield* ExtensionCompiler;
  const trust = yield* CodeTrust;
  const { root } = yield* KbCtx;
  const updated: z.infer<typeof Change>[] = [];
  return yield* storage.mutate(
    Effect.fn("extension.update.write")(function* (tx: ExtensionTransaction) {
      for (const scope of input.scope === undefined ? EXTENSION_SCOPES : [input.scope]) {
        const { lock } = yield* storage.read(root, scope);
        for (const [name, entry] of namedEntries(lock.extensions, input.name)) {
          const request = yield* resolveRecordedRequest(entry.original, root, scope, lock);
          const plan = yield* extensionPlan(request.pin);
          if (plan.source.name !== name)
            return yield* domainError(
              "invalid_input",
              `upstream extension changed name from ${name} to ${plan.source.name}`,
            );
          const previousTree = yield* storage.tree({
            kind: "extension",
            name,
            files: entry.locked.files,
          });
          let previous = entry.previous;
          if (previousTree !== null) {
            const before = yield* compiler.compile(previousTree.dir, name);
            if ((yield* trust.trusted([before])).includes(before)) previous = entry.locked;
          }
          const tree =
            plan.cached ?? (yield* tx.store({ kind: "extension", pin: request.pin }, plan.source));
          const digest = yield* compiler.compile(tree.dir, name);
          if (request.marketplace !== undefined)
            yield* tx.store(
              { kind: "marketplace", pin: request.marketplace.selection.locked },
              request.marketplace.source,
            );
          const next: ExtensionSelection = {
            original: request.original,
            locked: { ...request.pin, files: tree.files },
            ...(previous === undefined || previous.files === tree.files ? {} : { previous }),
          };
          yield* tx.update(root, scope, (held) => ({
            ...held,
            extensions: { ...held.extensions, [name]: next },
            marketplaces: {
              ...held.marketplaces,
              ...(request.marketplace === undefined
                ? {}
                : { [request.marketplace.name]: request.marketplace.selection }),
            },
          }));
          updated.push({
            name,
            scope,
            from: entry.locked.rev,
            to: request.pin.rev,
            files: changedFiles(previousTree?.source.files ?? [], plan.source.files).map(
              ({ path }) => path,
            ),
            digest,
            trusted: (yield* trust.trusted([digest])).includes(digest),
            review: `kb ext trust ${name}`,
          });
        }
      }
      if (input.name !== undefined && updated.length === 0)
        return yield* domainError("not_found", `no installed extension named ${input.name}`);
      return { updated, reload: "restart kb ui" as const };
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
    "Keep every candidate, previous and marketplace source named by the user lock or any registered location. Retire this machine's unreferenced provenance trust, then remove unused trees, pin indexes and abandoned staging. Never removes nodes or trust without provenance.",
  mode: { kind: "write", outsideRoot: true } as const,
  inputSchema: z.object({}),
  outputSchema: z.object({
    trees: z.array(z.string()),
    stages: z.array(z.string()),
    retained: z.array(z.string()),
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
      yield* trust.retain(retained);
      return { ...(yield* plan.sweep), retained };
    }),
  );
});
