/**
 * Backups of the session's store, and putting one back (DESIGN.md → Storage
 * → Backups). What a backup is and where it lives is the runtime's
 * (`KbRoots`); what these actions decide is policy: how many a machine
 * keeps (core's `backups kept` setting), that a state already backed up is
 * not copied twice, and that a restore is one transaction on the live store,
 * taken after a backup of what it replaces.
 */
import { Effect } from "effect";
import { z } from "zod";
import {
  KbCtx,
  KbRoots,
  KbStore,
  type ActionDefinition,
  type KbRootsPort,
  type StoreBackup,
} from "@kb/contracts";
import {
  SYSTEM_IDS,
  diffTx,
  domainError,
  extensionNodeId,
  type DomainError,
  type KbNode,
} from "@kb/model";
import { persistPlannedEffect } from "./session.ts";

/** How many backups a machine keeps of a store whose `backups kept` is unset. */
export const DEFAULT_BACKUPS_KEPT = 3;

/** Core's `backups kept` on `nodes`' core node: a whole number from 1, else the default. */
export function backupsKept(nodes: readonly KbNode[]): number {
  const core = nodes.find((node) => node.id === extensionNodeId("core"));
  const [value] = core?.props[SYSTEM_IDS.backupsKeptField] ?? [];
  if (value?.t !== "num" || !Number.isFinite(value.v)) return DEFAULT_BACKUPS_KEPT;
  return Math.max(1, Math.floor(value.v));
}

/** The backups `nodes` pin (`backup pin`): kept out of retention, whatever their age. */
function pinnedBackups(nodes: readonly KbNode[]): string[] {
  const pinned = new Set<string>();
  for (const node of nodes)
    for (const value of node.props[SYSTEM_IDS.backupPinField] ?? [])
      if (value.t === "str") pinned.add(value.v);
  return [...pinned];
}

const BackupSchema = z.object({
  id: z.string(),
  path: z.string(),
  root: z.string(),
  backend: z.string(),
  fingerprint: z.string().nullable(),
  nodes: z.number(),
  at: z.string(),
});

/**
 * The newest backup when it is of the store's state now: a backup's
 * fingerprint is the source's at the copy, so it is this state exactly when
 * the store still says that fingerprint.
 */
const currentBackup = Effect.fn("store.backup.current")(function* (
  roots: KbRootsPort,
  root: string,
): Effect.fn.Return<StoreBackup | undefined, DomainError, KbStore> {
  const now = yield* (yield* KbStore).fingerprint;
  const [newest] = yield* roots.backups(root);
  return now !== null && newest?.fingerprint === now ? newest : undefined;
});

export const storeBackupDef = {
  id: "store.backup",
  title: "Back up this store",
  description:
    "Copy this root's store, as it is now, into a backup on this machine (a kb root of its own under KB_DATA/backups), keeping the newest `backups kept` (a setting of core's node) and every backup a node pins (`backup pin`). A store already backed up as it is answers that backup",
  mode: { kind: "write", outsideRoot: true } as const,
  inputSchema: z.object({}),
  outputSchema: z.object({
    backup: BackupSchema,
    /** False when the newest backup already was this state, and nothing was copied. */
    fresh: z.boolean(),
    /** The older backups retention removed. */
    removed: z.array(BackupSchema),
  }),
} satisfies ActionDefinition;

/**
 * A backup of the store as it is now: the newest one when it already is
 * (`fresh: false`), else a new one, after which all but the newest `backups
 * kept` are removed.
 */
export const storeBackupEffect = Effect.fn("store.backup")(function* (): Effect.fn.Return<
  { backup: StoreBackup; fresh: boolean; removed: StoreBackup[] },
  DomainError,
  KbCtx | KbStore | KbRoots
> {
  const ctx = yield* KbCtx;
  const roots = yield* KbRoots;
  const held = yield* currentBackup(roots, ctx.root);
  if (held !== undefined) return { backup: held, fresh: false, removed: [] };
  const taken = yield* roots.backup(ctx.root, {
    keep: backupsKept(ctx.nodes),
    pinned: pinnedBackups(ctx.nodes),
  });
  return { backup: taken.backup, fresh: true, removed: [...taken.removed] };
});

export const storeBackupsDef = {
  id: "store.backups",
  title: "List this store's backups",
  description:
    "This root's backups on this machine, newest first, each marked current when the store is still the state it holds",
  mode: { kind: "read", outsideRoot: true } as const,
  inputSchema: z.object({}),
  outputSchema: z.object({
    backups: z.array(
      BackupSchema.extend({
        current: z.boolean(),
        /** A node pins it (`backup pin`), so retention keeps it. */
        pinned: z.boolean(),
      }),
    ),
    /** How many this machine keeps of this store. */
    kept: z.number(),
  }),
} satisfies ActionDefinition;

export const storeBackupsEffect = Effect.fn("store.backups")(function* (): Effect.fn.Return<
  z.infer<typeof storeBackupsDef.outputSchema>,
  DomainError,
  KbCtx | KbStore | KbRoots
> {
  const ctx = yield* KbCtx;
  const roots = yield* KbRoots;
  const current = yield* currentBackup(roots, ctx.root);
  const backups = yield* roots.backups(ctx.root);
  const pinned = new Set(pinnedBackups(ctx.nodes));
  return {
    backups: backups.map((backup) => ({
      ...backup,
      current: backup.id === current?.id,
      pinned: pinned.has(backup.id),
    })),
    kept: backupsKept(ctx.nodes),
  };
});

export const storeRestoreDef = {
  id: "store.restore",
  title: "Restore a backup",
  description:
    "Put this store back to a backup's state as one transaction (served pages see it as any write), after backing up the state it replaces, so the restore is itself undone by restoring that backup",
  mode: { kind: "write", approval: "required", outsideRoot: true } as const,
  inputSchema: z.object({
    /** The backup's id, as `store.backups` lists it. */
    backup: z.string().min(1),
  }),
  outputSchema: z.object({
    restored: BackupSchema,
    /** The backup of the state the restore replaced. */
    replaced: BackupSchema,
    upserts: z.number(),
    deletes: z.number(),
  }),
} satisfies ActionDefinition;

export const storeRestoreEffect = Effect.fn("store.restore")(function* (input: {
  readonly backup: string;
}): Effect.fn.Return<
  z.infer<typeof storeRestoreDef.outputSchema>,
  DomainError,
  KbCtx | KbStore | KbRoots
> {
  const ctx = yield* KbCtx;
  const roots = yield* KbRoots;
  const restored = (yield* roots.backups(ctx.root)).find((held) => held.id === input.backup);
  if (restored === undefined)
    return yield* domainError("not_found", `no backup ${input.backup} of ${ctx.root}`, {
      backup: input.backup,
    });
  // Read before the backup of the state it replaces: that backup's retention
  // may remove the oldest, which can be this one.
  const nodes = yield* roots.snapshot(restored.path);
  const replaced = (yield* storeBackupEffect()).backup;
  const tx = yield* persistPlannedEffect(
    ctx,
    (now) => Effect.succeed(diffTx(now, nodes)),
    // Kb's own write: the backup holds the system nodes as they were.
    { systemWrites: "system" },
  );
  return {
    restored,
    replaced,
    upserts: tx?.upserts.length ?? 0,
    deletes: tx?.deletes.length ?? 0,
  };
});
