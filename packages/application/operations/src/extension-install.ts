import { Effect } from "effect";
import { z } from "zod";
import { parseSource, SourceReader, type PinnedSource } from "@kb/extension-source";
import {
  CodeTrust,
  ExtensionCompiler,
  ExtensionStorage,
  KbCtx,
  DEFAULT_EXTENSION_SCOPE,
  EXTENSION_SCOPES,
  ExtensionScopeSchema,
  type ActionDefinition,
} from "@kb/contracts";
import { domainError } from "@kb/model";

export const extensionInstallDef = {
  id: "extension.install",
  title: "Install extensions",
  description:
    "Install a GitHub source at a full commit into the shared verified source cache and select it in a lock. With no source, restore missing or tampered trees named by locks. Compiles without importing or trusting; restart running kb ui until live reload is available.",
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
  const reader = yield* SourceReader;
  const compiler = yield* ExtensionCompiler;
  const trust = yield* CodeTrust;
  const { root } = yield* KbCtx;
  const installed: z.infer<typeof extensionInstallDef.outputSchema>["installed"] = [];
  const materialize = Effect.fn("extension.install.materialize")(function* (
    pin: PinnedSource,
    expected?: { readonly name: string; readonly files: string },
  ) {
    const cached = yield* storage.cached(pin);
    const plan =
      cached !== null
        ? {
            name: cached.name,
            files: cached.files,
            ignored: cached.ignored,
            cached: true,
            value: Effect.succeed(cached),
          }
        : yield* reader.read(pin).pipe(
            Effect.mapError((error) => domainError("invalid_input", error.message)),
            Effect.map((source) => ({
              name: source.name,
              files: source.hash,
              ignored: source.ignored,
              cached: false,
              value: storage.store(pin, source),
            })),
          );
    if (expected !== undefined && (plan.name !== expected.name || plan.files !== expected.files))
      return yield* domainError("invalid_input", "fetched source does not match its lock");
    return { tree: yield* plan.value, ignored: plan.ignored, cached: plan.cached };
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
    const original = input.source;
    const source = yield* Effect.try({
      try: () => parseSource(original),
      catch: (error) => domainError("invalid_input", String(error)),
    });
    const pin = yield* reader
      .resolve(source)
      .pipe(Effect.mapError((error) => domainError("invalid_input", error.message)));
    const prepared = yield* materialize(pin);
    yield* record(pin, prepared);
    yield* storage.update(root, input.scope ?? DEFAULT_EXTENSION_SCOPE, (held) => ({
      ...held,
      extensions: {
        ...held.extensions,
        [prepared.tree.name]: {
          original,
          locked: { ...pin, files: prepared.tree.files },
        },
      },
    }));
  } else {
    const visited = new Set<string>();
    for (const scope of EXTENSION_SCOPES) {
      const lock = yield* storage.read(root, scope);
      for (const [name, entry] of Object.entries(lock.extensions)) {
        const key = `${name}\0${entry.locked.files}`;
        if (visited.has(key)) continue;
        visited.add(key);
        const held = yield* storage
          .tree(name, entry.locked.files)
          .pipe(Effect.orElseSucceed(() => null));
        if (held === null) {
          const prepared = yield* materialize(entry.locked, { name, files: entry.locked.files });
          yield* record(entry.locked, prepared);
        }
      }
    }
  }
  return { installed, reload: "restart kb ui" as const };
});
