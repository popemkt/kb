import { Context, type Effect, type Stream } from "effect";
import { z } from "zod";
import {
  pinnedSchema,
  artifactName,
  type PinnedSource,
  type SelectedSource,
  type SourceTree,
} from "@kb/extension-source";
import type { ExtensionFailure } from "./extension.ts";
import type { DomainError } from "@kb/model";

export const EXTENSION_SCOPES = ["local", "store", "user"] as const;
export const DEFAULT_EXTENSION_SCOPE = "store" as const;
/** Running surfaces follow lock and trust changes without a restart. */
export const EXTENSION_RELOAD = "live" as const;
export const ExtensionScopeSchema = z.enum(EXTENSION_SCOPES);
export type ExtensionScope = z.infer<typeof ExtensionScopeSchema>;
export const ExtensionNameSchema = artifactName;
export const SourceHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const SourceKindSchema = z.enum(["extension", "marketplace"]);
export const SourceAddressSchema = z.object({
  kind: SourceKindSchema,
  name: ExtensionNameSchema,
  files: SourceHashSchema,
});
export type SourceAddress = z.infer<typeof SourceAddressSchema>;
export interface SourceSelection {
  readonly kind: z.infer<typeof SourceKindSchema>;
  readonly pin: PinnedSource;
}
export const LockedSourceSchema = pinnedSchema.extend({ files: SourceHashSchema });
export const CachedSourceSchema = SourceAddressSchema.extend({
  version: z.literal(1),
  pin: pinnedSchema,
  ignored: z.array(z.string()),
});
export const ExtensionSelectionSchema = z.object({
  original: z.string(),
  locked: LockedSourceSchema,
  previous: LockedSourceSchema.optional(),
});
export const ExtensionLockSchema = z.object({
  version: z.literal(1),
  extensions: z.record(ExtensionNameSchema, ExtensionSelectionSchema),
  marketplaces: z.record(ExtensionNameSchema, ExtensionSelectionSchema),
  links: z.array(z.string().min(1)),
});
export type ExtensionLock = z.infer<typeof ExtensionLockSchema>;
export type ExtensionSelection = z.infer<typeof ExtensionSelectionSchema>;
interface ExtensionLockRead {
  readonly lock: ExtensionLock;
  readonly failures: readonly ExtensionFailure[];
}
export interface CachedTree extends SourceAddress {
  readonly dir: string;
  readonly ignored: readonly string[];
  readonly source: SourceTree;
}
/** Write capabilities exist inside one cross-process installation-state mutation. */
interface ExtensionCollection {
  readonly retained: readonly SourceAddress[];
  readonly sweep: Effect.Effect<
    {
      trees: readonly string[];
      stages: readonly string[];
      orphanedLocalLocks: readonly { path: string; root: string }[];
    },
    DomainError
  >;
}
export interface ExtensionTransaction {
  collection(roots: readonly string[]): Effect.Effect<ExtensionCollection, DomainError>;
  links(
    root: string,
    scope: ExtensionScope,
    edit: { readonly add: string } | { readonly remove: string },
  ): Effect.Effect<string, DomainError>;
  update(
    root: string,
    scope: ExtensionScope,
    change: (held: ExtensionLock) => ExtensionLock,
  ): Effect.Effect<void, DomainError>;
  store(selection: SourceSelection, source: SelectedSource): Effect.Effect<CachedTree, DomainError>;
}
/** Read-only opening; every cache/lock writer serializes through mutate, including future collection. */
export class ExtensionStorage extends Context.Service<
  ExtensionStorage,
  {
    /** Opaque content state of the effective locks; reading never creates state. */
    fingerprint(root: string): Effect.Effect<string>;
    /** Initial armed state, then lock changes from any process; read-only and bounded by STORE_CHANGES_POLL. */
    changes(root: string): Stream.Stream<void>;
    read(root: string, scope: ExtensionScope): Effect.Effect<ExtensionLockRead, DomainError>;
    cached(selection: SourceSelection): Effect.Effect<CachedTree | null, DomainError>;
    tree(address: SourceAddress): Effect.Effect<CachedTree | null, DomainError>;
    mutate<A, E, R>(
      body: (transaction: ExtensionTransaction) => Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E | DomainError, R>;
  }
>()("kb/ExtensionStorage") {}
/** The host's existing closure reader; compile only, never import. */
export class ExtensionCompiler extends Context.Service<
  ExtensionCompiler,
  {
    compile(dir: string, name: string): Effect.Effect<string, DomainError>;
  }
>()("kb/ExtensionCompiler") {}
