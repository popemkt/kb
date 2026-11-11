/**
 * Plugin data migrations (DESIGN.md → Action registry → Plugin data
 * migrations): the actions that run a family's migration script, a step
 * each of the procedure `migration.<family>.<id>` (`migrationProcedure`).
 *
 * The script only plans. These actions take the backup it can be rolled back
 * to, record the plan a person previewed, apply that plan and nothing else as
 * one transaction, verify the result, and keep it or put the store back
 * after a trial. Where a migration stands is its record node (tagged
 * `migration`, under the Migrations list), never state these actions hold:
 * `migration.progress` reads it, so the procedure resumes wherever it was
 * left. Until the migration is kept, the record pins its backup, so
 * retention cannot remove what a roll back needs.
 */
import { Effect, Schema } from "effect";
import { z } from "zod";
import {
  FamilyKernels,
  KbCtx,
  KbRoots,
  KbStore,
  MIGRATION_STEPS,
  MigrationPoint,
  type ActionDefinition,
  type ExtensionMigration,
  type MigrationGraph,
  type MigrationStep,
} from "@kb/contracts";
import {
  KbNodeSchema,
  MIGRATION_STATES,
  SYSTEM_IDS,
  canonicalJson,
  currentIso,
  diffTx,
  domainError,
  migrationRecordId,
  migrationStateId,
  type DomainError,
  type KbNode,
  type MigrationState,
  type NodeId,
} from "@kb/model";
import { trustDigest } from "@kb/sandbox";
import { persistPlannedEffect, reloadEffect } from "./session.ts";
import { currentBackup, storeRestoreEffect } from "./store-backup.ts";

/** What the digest of a plan covers; a change to it makes every preview stale. */
const PLAN_FORMAT = "kb.migration/1";
/** How many of a plan's nodes `migration.plan` names. */
const SAMPLES = 20;

/** A migration as a record reads it: where it stands, and what it was previewed at. */
interface MigrationRecord {
  readonly state: MigrationState;
  readonly digest: string;
  readonly at: string;
  readonly backup: string;
  readonly problems: readonly string[];
}

/** A migration's plan, as kb applies it: only what changes the graph, and its digest. */
interface Plan {
  readonly at: string;
  readonly upserts: readonly KbNode[];
  readonly deletes: readonly NodeId[];
  /** How many of `upserts` the graph does not hold yet. */
  readonly creates: number;
  readonly digest: string;
}

/** Whether `id` is the migrations' own ledger: the list, or a record. */
function isLedger(id: NodeId): boolean {
  return id === SYSTEM_IDS.migrationsList || id.startsWith(migrationRecordId(""));
}

/** Every migration this host's kernels hold, by `<family>.<id>`, the first kernel's winning. */
const migrations = Effect.fn("migration.all")(function* (): Effect.fn.Return<
  ReadonlyMap<string, ExtensionMigration>,
  never,
  FamilyKernels
> {
  const found = new Map<string, ExtensionMigration>();
  for (const { kernel } of yield* FamilyKernels)
    for (const { id, value } of kernel.contributions(MigrationPoint))
      if (!found.has(id)) found.set(id, value);
  return found;
});

const migrationOf = Effect.fn("migration.of")(function* (
  id: string,
): Effect.fn.Return<ExtensionMigration, DomainError, FamilyKernels> {
  const found = (yield* migrations()).get(id);
  return found ?? (yield* domainError("not_found", `no migration ${id}`, { migration: id }));
});

const text = (node: KbNode | undefined, field: string): string | undefined => {
  const [value] = node?.props[field] ?? [];
  return value?.t === "str" ? value.v : undefined;
};

/**
 * The record of `id` in `nodes`, unless there is none or the migration was
 * rolled back: a rolled-back migration is offered again, as one never run.
 */
function liveRecord(nodes: readonly KbNode[], id: string): MigrationRecord | undefined {
  const node = nodes.find((held) => held.id === migrationRecordId(id));
  const [ref] = node?.props[SYSTEM_IDS.migrationStateField] ?? [];
  const state = MIGRATION_STATES.find(
    (candidate) => ref?.t === "ref" && ref.v === migrationStateId(candidate),
  );
  if (state === undefined || state === "rolled-back") return undefined;
  return {
    state,
    digest: text(node, SYSTEM_IDS.migrationDigestField) ?? "",
    at: text(node, SYSTEM_IDS.migrationAtField) ?? "",
    backup: text(node, SYSTEM_IDS.migrationBackupField) ?? "",
    problems: (node?.props[SYSTEM_IDS.migrationProblemsField] ?? []).flatMap((value) =>
      value.t === "str" ? [value.v] : [],
    ),
  };
}

/**
 * The write that records `id` as `record`: its node, and, the first time,
 * the Migrations list with it among its children. It pins the backup until
 * the migration is kept or rolled back.
 */
const str = (v: string) => ({ t: "str", v }) as const;

function recordWrite(
  nodes: readonly KbNode[],
  id: string,
  title: string,
  record: MigrationRecord,
  now: string,
): KbNode[] {
  const nodeId = migrationRecordId(id);
  const held = nodes.find((node) => node.id === nodeId);
  const pinned = record.state !== "kept" && record.state !== "rolled-back";
  const props = { ...held?.props };
  delete props[SYSTEM_IDS.backupPinField];
  delete props[SYSTEM_IDS.migrationProblemsField];
  const node: KbNode = {
    id: nodeId,
    text: held?.text ?? title,
    props: {
      ...props,
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.migrationTag }],
      [SYSTEM_IDS.migrationField]: [str(id)],
      [SYSTEM_IDS.migrationStateField]: [{ t: "ref", v: migrationStateId(record.state) }],
      [SYSTEM_IDS.migrationDigestField]: [str(record.digest)],
      [SYSTEM_IDS.migrationAtField]: [str(record.at)],
      [SYSTEM_IDS.migrationBackupField]: [str(record.backup)],
      ...(record.problems.length === 0
        ? {}
        : { [SYSTEM_IDS.migrationProblemsField]: record.problems.map(str) }),
      ...(pinned ? { [SYSTEM_IDS.backupPinField]: [str(record.backup)] } : {}),
    },
    children: [...(held?.children ?? [])],
    createdAt: held?.createdAt ?? now,
    updatedAt: now,
  };
  const list = nodes.find((entry) => entry.id === SYSTEM_IDS.migrationsList);
  const filed =
    list === undefined || list.children.includes(nodeId)
      ? []
      : [{ ...list, children: [...list.children, nodeId], updatedAt: now }];
  return [node, ...filed];
}

/** The graph a migration reads at `at`: `nodes` without the migrations' ledger. */
function graphOf(nodes: readonly KbNode[], at: string): MigrationGraph {
  const kept = nodes.flatMap((node) =>
    isLedger(node.id)
      ? []
      : [
          node.children.some(isLedger)
            ? { ...node, children: node.children.filter((child) => !isLedger(child)) }
            : node,
        ],
  );
  const byId = new Map(kept.map((node) => [node.id, node]));
  return { nodes: kept, nodeOf: (id) => byId.get(id), at };
}

const decodeNodes = Schema.decodeUnknownEffect(Schema.Array(KbNodeSchema));

/**
 * What `migration` plans for `nodes` at `at`, as kb applies it: its nodes
 * held to the node shape, what it would write unchanged left out, and none
 * of the ledger touched. Its digest covers exactly that, so a preview and
 * an apply that plan the same agree on it.
 */
const planOf = Effect.fn("migration.planOf")(function* (
  id: string,
  migration: ExtensionMigration,
  nodes: readonly KbNode[],
  at: string,
): Effect.fn.Return<Plan, DomainError> {
  const graph = graphOf(nodes, at);
  const planned = yield* Effect.try({
    try: () => migration.run(graph),
    catch: (cause) =>
      domainError("internal", `migration ${id} failed to plan: ${String(cause)}`, {
        migration: id,
      }),
  });
  const upserts = yield* decodeNodes(planned.upserts).pipe(
    Effect.mapError((cause) =>
      domainError(
        "invalid_input",
        `migration ${id} planned a node kb cannot hold: ${cause.message}`,
        {
          migration: id,
        },
      ),
    ),
  );
  const touched = [...upserts.map((node) => node.id), ...planned.deletes].filter(isLedger);
  if (touched.length > 0)
    return yield* domainError(
      "invalid_input",
      `migration ${id} planned a write to the migrations' ledger (${touched.join(", ")})`,
      { migration: id },
    );
  const changed = upserts.filter((node) => {
    const held = graph.nodeOf(node.id);
    return held === undefined || canonicalJson(held) !== canonicalJson(node);
  });
  const deletes = [...new Set(planned.deletes)].filter((del) => graph.nodeOf(del) !== undefined);
  const digest = yield* trustDigest({
    format: PLAN_FORMAT,
    migration: id,
    upserts: changed.toSorted((a, b) => a.id.localeCompare(b.id)),
    deletes: deletes.toSorted(),
  });
  return {
    at,
    upserts: changed,
    deletes,
    creates: changed.filter((node) => graph.nodeOf(node.id) === undefined).length,
    digest,
  };
});

/** Whether `plan` writes nothing: the migration has nothing to do. */
const isEmpty = (plan: Plan) => plan.upserts.length === 0 && plan.deletes.length === 0;

/** The instant the plan `record` previewed was made at, or now for a migration with none. */
const plannedAt = (record: MigrationRecord | undefined) =>
  record === undefined ? currentIso : Effect.succeed(record.at);

/** `id`'s record when it is in one of `states`, else the conflict naming where it stands. */
const recordIn = Effect.fn("migration.recordIn")(function* (
  nodes: readonly KbNode[],
  id: string,
  states: readonly MigrationState[],
  doing: string,
): Effect.fn.Return<MigrationRecord, DomainError> {
  const record = liveRecord(nodes, id);
  if (record !== undefined && states.includes(record.state)) return record;
  return yield* domainError(
    "conflict",
    `${id} cannot ${doing}: it is ${record?.state ?? "not previewed"}, and that needs it ${states.join(" or ")}`,
    { migration: id, state: record?.state ?? null },
  );
});

const MigrationInput = z.object({ migration: z.string().min(1) });
type MigrationInputT = z.infer<typeof MigrationInput>;

const STATE = z.enum(MIGRATION_STATES);

export const migrationListDef = {
  id: "migration.list",
  title: "List migrations",
  description:
    "The data migrations the loaded families ship, each with its state (null when never run, or rolled back) and whether it is pending: not kept, and either under way or planning a change",
  mode: { kind: "read" } as const,
  inputSchema: z.object({}),
  outputSchema: z.object({
    migrations: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        state: STATE.nullable(),
        pending: z.boolean(),
        /** How many nodes it would write or delete now. */
        changes: z.number(),
        /** Why it could not be planned, when it could not. */
        problem: z.string().optional(),
      }),
    ),
  }),
} satisfies ActionDefinition;

export const migrationListEffect = Effect.fn("migration.list")(function* (): Effect.fn.Return<
  z.infer<typeof migrationListDef.outputSchema>,
  DomainError,
  KbCtx | KbStore | FamilyKernels
> {
  const ctx = yield* KbCtx;
  yield* reloadEffect(ctx);
  const nodes = ctx.nodes;
  const all = [...(yield* migrations()).entries()].toSorted(([a], [b]) => a.localeCompare(b));
  const now = yield* currentIso;
  return {
    migrations: yield* Effect.forEach(all, ([id, migration]) =>
      Effect.gen(function* () {
        const record = liveRecord(nodes, id);
        const state = record?.state ?? null;
        const planned = yield* planOf(id, migration, nodes, record?.at ?? now).pipe(
          Effect.map((plan) => ({ changes: plan.upserts.length + plan.deletes.length })),
          // One migration that cannot plan does not hide the others; it is pending until it can.
          Effect.catch((err: DomainError) => Effect.succeed({ changes: 0, problem: err.message })),
        );
        return {
          id,
          title: migration.title,
          state,
          pending:
            state !== "kept" &&
            (record !== undefined || planned.changes > 0 || "problem" in planned),
          ...planned,
        };
      }),
    ),
  };
});

const Sample = z.object({
  id: z.string(),
  text: z.string(),
  change: z.enum(["create", "change", "delete"]),
});

export const migrationPlanDef = {
  id: "migration.plan",
  title: "Plan a migration",
  description:
    "What a migration would write now (or, once previewed, at the instant it was previewed): how many nodes it creates, changes and deletes, the first of them, and the plan's digest, which says whether the preview still holds",
  mode: { kind: "read" } as const,
  inputSchema: MigrationInput,
  outputSchema: z.object({
    migration: z.string(),
    at: z.string(),
    digest: z.string(),
    creates: z.number(),
    changes: z.number(),
    deletes: z.number(),
    samples: z.array(Sample),
    /** The migration was previewed with exactly this plan. */
    previewed: z.boolean(),
  }),
} satisfies ActionDefinition;

export const migrationPlanEffect = Effect.fn("migration.plan")(function* (
  input: MigrationInputT,
): Effect.fn.Return<
  z.infer<typeof migrationPlanDef.outputSchema>,
  DomainError,
  KbCtx | KbStore | FamilyKernels
> {
  const migration = yield* migrationOf(input.migration);
  const ctx = yield* KbCtx;
  yield* reloadEffect(ctx);
  const graph = graphOf(ctx.nodes, "");
  const record = liveRecord(ctx.nodes, input.migration);
  const plan = yield* planOf(input.migration, migration, ctx.nodes, yield* plannedAt(record));
  const samples = [
    ...plan.upserts.map((node) => ({
      id: node.id,
      text: node.text,
      change: graph.nodeOf(node.id) === undefined ? ("create" as const) : ("change" as const),
    })),
    ...plan.deletes.map((id) => ({
      id,
      text: graph.nodeOf(id)?.text ?? "",
      change: "delete" as const,
    })),
  ].slice(0, SAMPLES);
  return {
    migration: input.migration,
    at: plan.at,
    digest: plan.digest,
    creates: plan.creates,
    changes: plan.upserts.length - plan.creates,
    deletes: plan.deletes.length,
    samples,
    previewed: record?.state === "previewed" && record.digest === plan.digest,
  };
});

/**
 * How many nodes the store holds differently from what the migration left:
 * the edits made since it, which a roll back undoes with it (GAP
 * [[01M74SGAXQNMA8CME3GEG09EVF]]). What it left is the backup taken before it
 * with its plan applied, planned again at the instant it was previewed,
 * which is the plan that landed.
 */
const editsSince = Effect.fn("migration.editsSince")(function* (
  id: string,
  migration: ExtensionMigration,
  record: MigrationRecord,
  nodes: readonly KbNode[],
): Effect.fn.Return<number, DomainError, KbCtx | KbRoots> {
  const ctx = yield* KbCtx;
  const roots = yield* KbRoots;
  const backup = (yield* roots.backups(ctx.root)).find((held) => held.id === record.backup);
  if (backup === undefined)
    return yield* domainError(
      "not_found",
      `the backup taken before ${id} (${record.backup}) is gone, so it cannot be rolled back`,
      { migration: id, backup: record.backup },
    );
  const before = yield* roots.snapshot(backup.path);
  const plan = yield* planOf(id, migration, before, record.at);
  const left = new Map(graphOf(before, record.at).nodes.map((node) => [node.id, node]));
  for (const node of plan.upserts) left.set(node.id, node);
  for (const deleted of plan.deletes) left.delete(deleted);
  const edits = diffTx([...left.values()], graphOf(nodes, record.at).nodes);
  return edits.upserts.length + edits.deletes.length;
});

/**
 * What rolling back would cost, said where the choice is made: the backup
 * it restores, how many nodes changed since the migration (undone by it),
 * and the backup that keeps them. Never a silent loss.
 */
const rollbackNotes = Effect.fn("migration.rollbackNotes")(function* (
  id: string,
  migration: ExtensionMigration,
  record: MigrationRecord,
  nodes: readonly KbNode[],
): Effect.fn.Return<string[], DomainError, KbCtx | KbStore | KbRoots> {
  const restores = `roll back restores backup ${record.backup}, taken before the migration`;
  const edits = yield* editsSince(id, migration, record, nodes);
  if (edits === 0)
    return [restores, "nothing has changed since the migration: roll back undoes only it"];
  const ctx = yield* KbCtx;
  const current = yield* currentBackup(yield* KbRoots, ctx.root);
  return [
    restores,
    `${edits} node(s) changed since the migration: roll back undoes those edits too`,
    current === undefined
      ? "they are kept in a backup of the store as it is now, which roll back takes first and names when it is done"
      : `they are kept in backup ${current.id}, of the store as it is now`,
  ];
});

export const migrationProgressDef = {
  id: "migration.progress",
  title: "Migration progress",
  description:
    "Whether a step of a migration's procedure is done, read from its record and this machine's backups; the keep-or-roll-back step recommends roll back, with the problems, when verify found any",
  mode: { kind: "read", outsideRoot: true } as const,
  inputSchema: MigrationInput.extend({ step: z.enum(MIGRATION_STEPS) }),
  outputSchema: z.object({
    done: z.boolean(),
    recommended: z.string().optional(),
    notes: z.array(z.string()),
  }),
} satisfies ActionDefinition;

/** The states in which `step` is behind the migration. */
const PAST: Readonly<
  Record<Exclude<MigrationStep, "backup" | "preview">, readonly MigrationState[]>
> = {
  apply: ["applied", "verified", "failed", "kept"],
  verify: ["verified", "failed", "kept"],
  decide: ["kept"],
};

export const migrationProgressEffect = Effect.fn("migration.progress")(function* (
  input: MigrationInputT & { readonly step: MigrationStep },
): Effect.fn.Return<
  z.infer<typeof migrationProgressDef.outputSchema>,
  DomainError,
  KbCtx | KbStore | KbRoots | FamilyKernels
> {
  const migration = yield* migrationOf(input.migration);
  const ctx = yield* KbCtx;
  yield* reloadEffect(ctx);
  const record = liveRecord(ctx.nodes, input.migration);
  switch (input.step) {
    case "backup": {
      const backup = yield* currentBackup(yield* KbRoots, ctx.root);
      return { done: backup !== undefined, notes: [] };
    }
    case "preview": {
      if (record?.state !== "previewed") return { done: false, notes: [] };
      const same =
        (yield* planOf(input.migration, migration, ctx.nodes, record.at)).digest === record.digest;
      return same
        ? { done: true, notes: [] }
        : {
            done: false,
            notes: ["the store plans differently since the preview: back up and preview again"],
          };
    }
    case "decide": {
      // Nothing to do and never started: the migration is not pending.
      if (record === undefined)
        return {
          done: isEmpty(yield* planOf(input.migration, migration, ctx.nodes, yield* currentIso)),
          notes: [],
        };
      if (record.state === "failed" || record.state === "verified") {
        const rollback = yield* rollbackNotes(input.migration, migration, record, ctx.nodes);
        return record.state === "failed"
          ? {
              done: false,
              recommended: "rollback",
              notes: [
                `verify found ${record.problems.length} problem(s):`,
                ...record.problems,
                ...rollback,
              ],
            }
          : { done: false, notes: ["on trial: keep makes it final, or roll back", ...rollback] };
      }
      return { done: PAST.decide.includes(record.state), notes: [] };
    }
    case "apply":
    case "verify":
      return { done: record !== undefined && PAST[input.step].includes(record.state), notes: [] };
    default:
      return yield* domainError("internal", "unknown migration step");
  }
});

const RecordOutput = z.object({
  migration: z.string(),
  state: STATE,
  digest: z.string(),
  backup: z.string(),
});

export const migrationPreviewDef = {
  id: "migration.preview",
  title: "Preview a migration",
  description:
    "Plan a migration and record the plan (its digest and instant) on the migration's record, with the backup of the store as it is now, which the record pins until the migration is kept or rolled back. Needs that backup (`store.backup`) first",
  mode: { kind: "write", outsideRoot: true } as const,
  inputSchema: MigrationInput,
  outputSchema: RecordOutput.extend({
    at: z.string(),
    creates: z.number(),
    changes: z.number(),
    deletes: z.number(),
  }),
} satisfies ActionDefinition;

export const migrationPreviewEffect = Effect.fn("migration.preview")(function* (
  input: MigrationInputT,
): Effect.fn.Return<
  z.infer<typeof migrationPreviewDef.outputSchema>,
  DomainError,
  KbCtx | KbStore | KbRoots | FamilyKernels
> {
  const id = input.migration;
  const migration = yield* migrationOf(id);
  const ctx = yield* KbCtx;
  const roots = yield* KbRoots;
  const at = yield* currentIso;
  let planned: { plan: Plan; backup: string } | undefined;
  const protectedBackup = yield* currentBackup(roots, ctx.root);
  if (protectedBackup === undefined)
    return yield* domainError(
      "conflict",
      `${id} needs a backup of the store as it is now first (store.backup)`,
      { migration: id },
    );
  yield* roots.useBackup(protectedBackup, () =>
    persistPlannedEffect(
      ctx,
      (nodes) =>
        Effect.gen(function* () {
          // Read on the state this commit lands on: the backup is of exactly it.
          if ((yield* (yield* KbStore).fingerprint) !== protectedBackup.fingerprint)
            return yield* domainError(
              "conflict",
              `${id} needs a backup of the current store first`,
              { migration: id },
            );
          const held = liveRecord(nodes, id);
          if (held !== undefined && held.state !== "previewed")
            return yield* domainError("conflict", `${id} is already ${held.state}`, {
              migration: id,
              state: held.state,
            });
          const plan = yield* planOf(id, migration, nodes, at);
          if (isEmpty(plan))
            return yield* domainError("conflict", `${id} has nothing to migrate`, {
              migration: id,
            });
          planned = { plan, backup: protectedBackup.id };
          const record = {
            state: "previewed",
            digest: plan.digest,
            at,
            backup: protectedBackup.id,
            problems: [],
          } as const;
          return { upserts: recordWrite(nodes, id, migration.title, record, at), deletes: [] };
        }),
      { systemWrites: "system" },
    ),
  );
  if (planned === undefined) return yield* domainError("internal", `${id} recorded no plan`);
  const { plan, backup } = planned;
  return {
    migration: id,
    state: "previewed" as const,
    digest: plan.digest,
    backup,
    at,
    creates: plan.creates,
    changes: plan.upserts.length - plan.creates,
    deletes: plan.deletes.length,
  };
});

export const migrationApplyDef = {
  id: "migration.apply",
  title: "Apply a migration",
  description:
    "Write the plan a migration was previewed with, as one transaction with its record, and only if planning it again at the previewed instant gives the same digest (else preview again)",
  mode: { kind: "write", approval: "required" } as const,
  inputSchema: MigrationInput,
  outputSchema: RecordOutput.extend({ upserts: z.number(), deletes: z.number() }),
} satisfies ActionDefinition;

export const migrationApplyEffect = Effect.fn("migration.apply")(function* (
  input: MigrationInputT,
): Effect.fn.Return<
  z.infer<typeof migrationApplyDef.outputSchema>,
  DomainError,
  KbCtx | KbStore | FamilyKernels
> {
  const id = input.migration;
  const migration = yield* migrationOf(id);
  const ctx = yield* KbCtx;
  const now = yield* currentIso;
  let applied: { record: MigrationRecord; plan: Plan } | undefined;
  yield* persistPlannedEffect(
    ctx,
    (nodes) =>
      Effect.gen(function* () {
        const previewed = yield* recordIn(nodes, id, ["previewed"], "be applied");
        const plan = yield* planOf(id, migration, nodes, previewed.at);
        if (plan.digest !== previewed.digest)
          return yield* domainError(
            "conflict",
            `${id} plans differently than when it was previewed: back up and preview again`,
            { migration: id, previewed: previewed.digest, now: plan.digest },
          );
        const record = { ...previewed, state: "applied" } as const;
        applied = { record, plan };
        return {
          upserts: [...plan.upserts, ...recordWrite(nodes, id, migration.title, record, now)],
          deletes: [...plan.deletes],
        };
      }),
    // Kb's own write: the plan may write a family's system nodes, and writes the record.
    { systemWrites: "system" },
  );
  if (applied === undefined) return yield* domainError("internal", `${id} applied no plan`);
  return {
    migration: id,
    state: applied.record.state,
    digest: applied.record.digest,
    backup: applied.record.backup,
    upserts: applied.plan.upserts.length,
    deletes: applied.plan.deletes.length,
  };
});

/** What `migration`'s own check finds wrong with `graph`; a check that throws is a problem too. */
function problemsOf(migration: ExtensionMigration, graph: MigrationGraph): string[] {
  try {
    return [...(migration.check?.(graph) ?? [])];
  } catch (cause) {
    return [`its check failed to run: ${String(cause)}`];
  }
}

export const migrationVerifyDef = {
  id: "migration.verify",
  title: "Verify a migration",
  description:
    "Check an applied migration: its family's check of the migrated graph, and that planning it again changes nothing. Records verified, or failed with the problems, which the keep-or-roll-back step then shows with roll back recommended",
  mode: { kind: "write" } as const,
  inputSchema: MigrationInput,
  outputSchema: RecordOutput.extend({ problems: z.array(z.string()) }),
} satisfies ActionDefinition;

export const migrationVerifyEffect = Effect.fn("migration.verify")(function* (
  input: MigrationInputT,
): Effect.fn.Return<
  z.infer<typeof migrationVerifyDef.outputSchema>,
  DomainError,
  KbCtx | KbStore | FamilyKernels
> {
  const id = input.migration;
  const migration = yield* migrationOf(id);
  const ctx = yield* KbCtx;
  const now = yield* currentIso;
  let verified: MigrationRecord | undefined;
  yield* persistPlannedEffect(
    ctx,
    (nodes) =>
      Effect.gen(function* () {
        const applied = yield* recordIn(
          nodes,
          id,
          ["applied", "verified", "failed"],
          "be verified",
        );
        const graph = graphOf(nodes, applied.at);
        const checked = problemsOf(migration, graph);
        const again = yield* planOf(id, migration, nodes, applied.at).pipe(
          Effect.map((plan) =>
            isEmpty(plan)
              ? []
              : [
                  `planning it again would still write ${plan.upserts.length} and delete ${plan.deletes.length} node(s)`,
                ],
          ),
          Effect.catch((err: DomainError) => Effect.succeed([err.message])),
        );
        const problems = [...checked, ...again];
        const record = {
          ...applied,
          state: problems.length === 0 ? "verified" : "failed",
          problems,
        } as const;
        verified = record;
        return { upserts: recordWrite(nodes, id, migration.title, record, now), deletes: [] };
      }),
    { systemWrites: "system" },
  );
  if (verified === undefined) return yield* domainError("internal", `${id} recorded no verify`);
  return {
    migration: id,
    state: verified.state,
    digest: verified.digest,
    backup: verified.backup,
    problems: [...verified.problems],
  };
});

export const migrationKeepDef = {
  id: "migration.keep",
  title: "Keep a migration",
  description:
    "End a verified migration's trial by keeping it: its record says kept, and stops pinning the backup taken before it, which retention may then age out. A migration whose verify failed may be kept too, with its problems on its record",
  mode: { kind: "write" } as const,
  inputSchema: MigrationInput,
  outputSchema: RecordOutput,
} satisfies ActionDefinition;

export const migrationKeepEffect = Effect.fn("migration.keep")(function* (
  input: MigrationInputT,
): Effect.fn.Return<
  z.infer<typeof migrationKeepDef.outputSchema>,
  DomainError,
  KbCtx | KbStore | FamilyKernels
> {
  const id = input.migration;
  const migration = yield* migrationOf(id);
  const ctx = yield* KbCtx;
  const now = yield* currentIso;
  let kept: MigrationRecord | undefined;
  yield* persistPlannedEffect(
    ctx,
    (nodes) =>
      Effect.gen(function* () {
        const held = yield* recordIn(nodes, id, ["verified", "failed"], "be kept");
        kept = { ...held, state: "kept" };
        return { upserts: recordWrite(nodes, id, migration.title, kept, now), deletes: [] };
      }),
    { systemWrites: "system" },
  );
  if (kept === undefined) return yield* domainError("internal", `${id} recorded no keep`);
  return { migration: id, state: kept.state, digest: kept.digest, backup: kept.backup };
});

export const migrationRollbackDef = {
  id: "migration.rollback",
  title: "Roll back a migration",
  description:
    "Put the store back to the backup taken before a migration (`store.restore`, which first backs up the state it replaces, edits made since the migration included), then record the migration rolled back, so it is offered again. Answers how many nodes had changed since the migration, and the backup that keeps them",
  mode: { kind: "write", approval: "required", outsideRoot: true } as const,
  inputSchema: MigrationInput,
  outputSchema: RecordOutput.extend({
    /** The backup of the state the roll back replaced: it keeps the edits `undone`. */
    replaced: z.string(),
    /** How many nodes had changed since the migration, and were put back with it. */
    undone: z.number(),
  }),
} satisfies ActionDefinition;

export const migrationRollbackEffect = Effect.fn("migration.rollback")(function* (
  input: MigrationInputT,
): Effect.fn.Return<
  z.infer<typeof migrationRollbackDef.outputSchema>,
  DomainError,
  KbCtx | KbStore | KbRoots | FamilyKernels
> {
  const id = input.migration;
  const migration = yield* migrationOf(id);
  const ctx = yield* KbCtx;
  yield* reloadEffect(ctx);
  const held = yield* recordIn(ctx.nodes, id, ["applied", "verified", "failed"], "be rolled back");
  const undone = yield* editsSince(id, migration, held, ctx.nodes);
  // GAP [[01M74SGAXQNMA8CME3GEG09EVF]] the whole store goes back, edits made during the trial with it.
  const restored = yield* storeRestoreEffect({ backup: held.backup });
  const now = yield* currentIso;
  const record = { ...held, state: "rolled-back" } as const;
  yield* persistPlannedEffect(
    ctx,
    (nodes) =>
      Effect.succeed({
        upserts: recordWrite(nodes, id, migration.title, record, now),
        deletes: [],
      }),
    { systemWrites: "system" },
  );
  return {
    migration: id,
    state: record.state,
    digest: record.digest,
    backup: record.backup,
    replaced: restored.replaced.id,
    undone,
  };
});
