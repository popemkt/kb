import { Effect } from "effect";
import { z } from "zod";
import type { PinnedSource } from "@kb/extension-source";
import {
  extensionPlan,
  marketplacePlan,
  pinnedMarketplaces,
  resolveExtensionRequest,
} from "./extension-plans.ts";
import {
  CodeTrust,
  ExtensionCompiler,
  ExtensionStorage,
  KbCtx,
  DEFAULT_EXTENSION_SCOPE,
  EXTENSION_SCOPES,
  ExtensionScopeSchema,
  type ActionDefinition,
  type ExtensionTransaction,
} from "@kb/contracts";
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
      }),
    ),
    reload: z.literal("restart kb ui"),
  }),
} satisfies ActionDefinition;
export const extensionInstallEffect = Effect.fn("extension.install")(function* (
  input: z.infer<typeof extensionInstallDef.inputSchema>,
) {
  const storage = yield* ExtensionStorage;
  const compiler = yield* ExtensionCompiler;
  const trust = yield* CodeTrust;
  const { root } = yield* KbCtx;
  const installed: z.infer<typeof extensionInstallDef.outputSchema>["installed"] = [];
  return yield* storage.mutate(
    Effect.fn("extension.install.write")(function* (transaction: ExtensionTransaction) {
      const materialize = Effect.fn("extension.install.materialize")(function* (
        pin: PinnedSource,
        expected?: { readonly name: string; readonly files?: string },
      ) {
        const plan = yield* extensionPlan(pin);
        if (
          expected !== undefined &&
          (plan.source.name !== expected.name ||
            (expected.files !== undefined && plan.source.hash !== expected.files))
        )
          return yield* domainError(
            "invalid_input",
            "fetched source does not match its lock or marketplace name",
          );
        const tree =
          plan.cached ?? (yield* transaction.store({ kind: "extension", pin }, plan.source));
        return { tree, ignored: plan.source.ignored, cached: plan.cached !== null };
      });
      const record = Effect.fn("extension.install.record")(function* (
        pin: PinnedSource,
        prepared: Effect.Success<ReturnType<typeof materialize>>,
      ) {
        const { tree, ignored, cached } = prepared;
        const digest = yield* compiler.compile(tree.dir, tree.name);
        installed.push({
          name: tree.name,
          rev: pin.rev,
          files: tree.files,
          digest,
          trusted: (yield* trust.trusted([digest])).includes(digest),
          ignored: [...ignored],
          cached,
        });
        return undefined;
      });
      if (input.source !== undefined) {
        const request = yield* resolveExtensionRequest(
          input.source,
          input.source.startsWith("github:") || input.source.startsWith("https://github.com/")
            ? []
            : yield* pinnedMarketplaces(root),
        );
        const prepared = yield* materialize(
          request.pin,
          request.name === undefined ? undefined : { name: request.name },
        );
        yield* record(request.pin, prepared);
        yield* transaction.update(root, input.scope ?? DEFAULT_EXTENSION_SCOPE, (held) => ({
          ...held,
          marketplaces: {
            ...held.marketplaces,
            ...(request.marketplace === undefined
              ? {}
              : { [request.marketplace.name]: request.marketplace.selection }),
          },
          extensions: {
            ...held.extensions,
            [prepared.tree.name]: {
              original: request.original,
              locked: { ...request.pin, files: prepared.tree.files },
            },
          },
        }));
      } else {
        const visited = new Set<string>();
        for (const scope of EXTENSION_SCOPES) {
          const { lock } = yield* storage.read(root, scope);
          for (const [name, entry] of Object.entries(lock.marketplaces)) {
            const present = yield* storage
              .tree({ kind: "marketplace", name, files: entry.locked.files })
              .pipe(Effect.orElseSucceed(() => null));
            if (present !== null) continue;
            const plan = yield* marketplacePlan(entry.locked);
            if (plan.source.name !== name || plan.source.hash !== entry.locked.files)
              return yield* domainError(
                "invalid_input",
                "fetched marketplace does not match its lock",
              );
            yield* transaction.store({ kind: "marketplace", pin: entry.locked }, plan.source);
          }
          for (const [name, entry] of Object.entries(lock.extensions)) {
            for (const pin of [
              entry.locked,
              ...(entry.previous === undefined ? [] : [entry.previous]),
            ]) {
              const key = `${name}\0${pin.files}`;
              if (visited.has(key)) continue;
              visited.add(key);
              const held = yield* storage
                .tree({ kind: "extension", name, files: pin.files })
                .pipe(Effect.orElseSucceed(() => null));
              if (held === null) {
                const prepared = yield* materialize(pin, {
                  name,
                  files: pin.files,
                });
                yield* record(pin, prepared);
              }
            }
          }
        }
      }
      return { installed, reload: "restart kb ui" as const };
    }),
  );
});
