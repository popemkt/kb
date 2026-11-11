/**
 * The kb roots on this machine beside a session's own, as an action reaches
 * them (DESIGN.md → Locations): what is at a path, which `kb ui` serves a
 * root, a session over a root, a `kb ui` started for one, what a root's store
 * holds read raw, and the backups of a root (DESIGN.md → Storage → Backups),
 * each of which is itself a root. A port for the reason the workspace ports
 * are one: the use case (the locations family's actions) names roots, and
 * only the runtime knows how a root's store is chosen by presence, how a
 * root is opened and seeded, and how a server says which root it serves.
 *
 * An action that uses it touches more than its own root, so its mode says
 * `outsideRoot`.
 */
import { Context, type Effect } from "effect";
import type { DomainError, KbNode } from "@kb/model";
import type { KbContext } from "./session.ts";

/** What a path holds, read from the directory alone: nothing there is opened or written. */
export type RootState =
  | { readonly kind: "store"; readonly backend: string }
  | { readonly kind: "missing"; readonly reason: string }
  | { readonly kind: "not-a-store"; readonly reason: string };

export interface RootProbe {
  /**
   * The path as a server names its root: absolute, with its symlinks
   * resolved where it exists, so two spellings of one root compare equal.
   */
  readonly path: string;
  readonly state: RootState;
}

/**
 * One backup of a root's store: a kb root of its own, holding the state the
 * store was in when it was taken, in the same backend.
 */
export interface StoreBackup {
  /** Its name among the root's backups; ordered as they were taken. */
  readonly id: string;
  /** The backup's own root, which opens as any root does. */
  readonly path: string;
  /** The root it is a backup of, as a server names its root. */
  readonly root: string;
  readonly backend: string;
  /**
   * The source store's fingerprint when it was copied: the state this backup
   * is. A store whose fingerprint is this one now is that state.
   */
  readonly fingerprint: string | null;
  readonly nodes: number;
  /** When it was taken (ISO). */
  readonly at: string;
}

/** What taking a backup did: the backup, and the older ones retention removed. */
export interface BackupTaken {
  readonly backup: StoreBackup;
  readonly removed: readonly StoreBackup[];
}

export interface KbRootsPort {
  /**
   * Where the person's home store lives on this machine (DESIGN.md →
   * Locations), whether or not there is one there yet.
   */
  readonly home: Effect.Effect<string>;
  /** Registered location paths, read from the home graph without seeding or importing code. */
  readonly registered: Effect.Effect<readonly string[], DomainError>;
  /** What is at `path`. Never fails for a path that is absent or not a store: that is its state. */
  readonly probe: (path: string) => Effect.Effect<RootProbe, DomainError>;
  /** The URL of the `kb ui` that serves `root` now, or null (presence, checked by asking it). */
  readonly served: (root: string) => Effect.Effect<string | null, DomainError>;
  /** Make `root` a kb root with an empty store, creating its directory, unless it is one. */
  readonly create: (root: string) => Effect.Effect<void, DomainError>;
  /** A session over `root`, opened as every surface opens one: its store chosen by presence, seeded. */
  readonly open: (root: string) => Effect.Effect<KbContext, DomainError>;
  /**
   * Start a `kb ui` serving `root` and answer its URL once it says it serves
   * the root. The server outlives the call, as a `kb ui` a person starts
   * does. Fails with what the server said when it stops first or does not
   * answer in time, and a server that has not served by then is stopped.
   * Concurrent calls for one root are one start, and each gets its answer.
   */
  readonly serve: (root: string) => Effect.Effect<string, DomainError>;
  /**
   * The nodes `root`'s store holds, read raw: no family is composed, no seed
   * folded, nothing written. Empty when it holds no store.
   */
  readonly snapshot: (root: string) => Effect.Effect<readonly KbNode[], DomainError>;
  /**
   * Copy `root`'s store, as one state of it, into a new backup, then remove
   * all but the newest `keep` of its backups (at least the one just taken),
   * never one the authoritative stored graph pins: those are kept beside the `keep`.
   * Pin reads and pruning share the same retention boundary as `useBackup`.
   */
  readonly backup: (
    root: string,
    options: { readonly keep: number },
  ) => Effect.Effect<BackupTaken, DomainError>;
  /** Validate and use a payload while retention cannot prune it, across processes. */
  readonly useBackup: <A, E, R>(
    backup: StoreBackup,
    use: (nodes: readonly KbNode[]) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | DomainError, R>;
  /** `root`'s backups on this machine, newest first. */
  readonly backups: (root: string) => Effect.Effect<readonly StoreBackup[], DomainError>;
}

export class KbRoots extends Context.Service<KbRoots, KbRootsPort>()("kb/KbRoots") {}
