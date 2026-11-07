import { Context, type Effect } from "effect";
import { z } from "zod";
import { pinnedSchema, type PinnedSource, type SourceTree } from "@kb/extension-source";
import type { DomainError } from "@kb/model";

export const EXTENSION_SCOPES = ["local", "store", "user"] as const;
export const DEFAULT_EXTENSION_SCOPE = "store" as const;
export const ExtensionScopeSchema = z.enum(EXTENSION_SCOPES);
export type ExtensionScope = z.infer<typeof ExtensionScopeSchema>;
export const ExtensionNameSchema = z.string().regex(/^[\w][\w.-]*$/);
export const SourceHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const LockedSourceSchema = pinnedSchema.extend({ files: SourceHashSchema });
export const CachedSourceSchema = z.object({
  version: z.literal(1),
  name: ExtensionNameSchema,
  files: SourceHashSchema,
  pin: pinnedSchema,
  ignored: z.array(z.string()),
});
export const ExtensionSelectionSchema = z.object({
  original: z.string(),
  locked: LockedSourceSchema,
});
export const ExtensionLockSchema = z.object({
  version: z.literal(1),
  extensions: z.record(ExtensionNameSchema, ExtensionSelectionSchema),
  marketplaces: z.record(ExtensionNameSchema, ExtensionSelectionSchema),
  links: z.array(z.string().min(1)),
});
export type ExtensionLock = z.infer<typeof ExtensionLockSchema>;
export type ExtensionSelection = z.infer<typeof ExtensionSelectionSchema>;
export interface CachedExtension {
  readonly name: string;
  readonly files: string;
  readonly dir: string;
  readonly ignored: readonly string[];
}

/** Installation state: atomic scope locks and immutable, verified source trees. Never imports code. */
export class ExtensionStorage extends Context.Service<
  ExtensionStorage,
  {
    read(root: string, scope: ExtensionScope): Effect.Effect<ExtensionLock, DomainError>;
    update(
      root: string,
      scope: ExtensionScope,
      change: (held: ExtensionLock) => ExtensionLock,
    ): Effect.Effect<void, DomainError>;
    cached(pin: PinnedSource): Effect.Effect<CachedExtension | null, DomainError>;
    tree(name: string, files: string): Effect.Effect<CachedExtension | null, DomainError>;
    store(pin: PinnedSource, tree: SourceTree): Effect.Effect<CachedExtension, DomainError>;
  }
>()("kb/ExtensionStorage") {}
/** The host's existing closure bundler, supplied once at composition. Compile only, never import. */
export class ExtensionCompiler extends Context.Service<
  ExtensionCompiler,
  {
    compile(dir: string, name: string): Effect.Effect<string, DomainError>;
  }
>()("kb/ExtensionCompiler") {}
