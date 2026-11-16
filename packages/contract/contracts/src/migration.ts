/**
 * A family's data migration (DESIGN.md → Action registry → Plugin data
 * migrations): a script the family ships, which reads the graph and returns
 * the transaction that moves its data to a new shape. Running it is a
 * procedure every surface walks alike: back up, preview, apply, verify, then
 * keep or roll back after a trial. The script is the family's code, held to
 * the trust its family is (kb's build, or a repository extension a person
 * trusted); what it plans is applied by kb's `migration.*` actions, as one
 * transaction, never by the script itself.
 */
import { z } from "zod";
import { Point } from "@kb/plugin";
import { MIGRATION_STATES, WRITE_KINDS, type KbNode, type NodeId } from "@kb/model";
import { CORE_POINT_DEFINITIONS } from "./point-definitions.ts";
import { PropValueSchema } from "./protocol.ts";
import type { ProcedureContribution, ProcedureStep } from "./procedure.ts";

/** What a migration reads: the graph, without the migrations' own records. */
export interface MigrationGraph {
  readonly nodes: readonly KbNode[];
  readonly nodeOf: (id: NodeId) => KbNode | undefined;
  /**
   * The instant the plan is made at, for any timestamp it writes: the same
   * on the preview and the apply, so the plan a person saw is the one that
   * lands.
   */
  readonly at: string;
}

/** What a migration plans: the nodes it writes, whole, and the ids it deletes. */
interface MigrationPlan {
  readonly upserts: readonly KbNode[];
  readonly deletes: readonly NodeId[];
}

/** A migration as a family declares it (`ExtensionDeclaration.migrations`). */
export interface ExtensionMigration {
  /** Its name within the family; the migration's id is `<family>.<id>`. */
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  /**
   * The transaction that migrates `graph`: pure, and planning nothing for a
   * graph already migrated, so a migration with nothing to do is not
   * pending and an applied one plans nothing again.
   */
  readonly run: (graph: MigrationGraph) => MigrationPlan;
  /** What is wrong with the migrated `graph`, one line each; none when it is right. */
  readonly check?: (graph: MigrationGraph) => readonly string[];
}

/** Every migration any loaded family declares, by `<family>.<id>`. */
export const MigrationPoint = Point<ExtensionMigration>()(
  CORE_POINT_DEFINITIONS.migration.name,
  CORE_POINT_DEFINITIONS.migration.spec,
);

/**
 * What `migration.list` answers: every migration the loaded families
 * declare, each with its state, whether it is pending, how many nodes it
 * would write now, and why it could not be planned, when it could not. The
 * CLI prints it and the page draws it, so it is the contract's, not one
 * surface's.
 */
export const MigrationListSchema = z.object({
  migrations: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      state: z.enum(MIGRATION_STATES).nullable(),
      pending: z.boolean(),
      /** How many nodes it would write or delete now. */
      changes: z.number(),
      /** Why it could not be planned, when it could not. */
      problem: z.string().optional(),
    }),
  ),
});

/** One value a part of a write holds: as stored, and for a reference the name of the node it names. */
const WriteValueSchema = z.object({ value: PropValueSchema, name: z.string().optional() });

/**
 * A plan, read node by node (DESIGN.md → Plugin data migrations, "A plan is
 * read node by node, and exactly"): its counts, and each write as
 * `@kb/model`'s `writeChange` reads it, all of them unless the call gave a
 * limit, with `more` counting the rest. What `migration.plan` and
 * `migration.preview` answer, what `kb migrate --plan` prints and what a
 * procedure step's `changes` draws on the page.
 */
export const PlanReadingSchema = z.object({
  creates: z.number(),
  changes: z.number(),
  deletes: z.number(),
  writes: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      kind: z.enum(WRITE_KINDS),
      parts: z.array(
        z.object({
          part: z.string(),
          label: z.string(),
          /** The values as the store holds them, typed and by id; a reference with its target's name. */
          before: z.array(WriteValueSchema),
          after: z.array(WriteValueSchema),
        }),
      ),
    }),
  ),
  /** How many writes the limit left out. */
  more: z.number(),
});

/** The procedure that runs the migration `id` (`<family>.<id>`). */
export function migrationProcedureId(id: string): string {
  return `migration.${id}`;
}

/** The steps of a migration's procedure, in order. */
export const MIGRATION_STEPS = ["backup", "preview", "apply", "verify", "decide"] as const;
export type MigrationStep = (typeof MIGRATION_STEPS)[number];

/**
 * The procedure that runs the migration `id`: each step a core action on
 * it, each step's done-ness `migration.progress` reading its record and the
 * backups, and the last a decision, keep or roll back, that nothing takes
 * for a person.
 */
export function migrationProcedure(
  id: string,
  migration: ExtensionMigration,
): ProcedureContribution {
  const on = { migration: id };
  const check = (step: MigrationStep) => ({
    action: "migration.progress",
    input: { ...on, step },
  });
  const one = (
    step: MigrationStep,
    title: string,
    description: string,
    action: string,
    input: unknown = on,
  ): ProcedureStep => ({
    id: step,
    title,
    description,
    actions: [{ id: step, title, call: { action, input } }],
    check: check(step),
  });
  // The preview and apply steps show the plan they record and write.
  const plan = { action: "migration.plan", input: on };
  return {
    title: migration.title,
    ...(migration.description === undefined ? {} : { description: migration.description }),
    steps: [
      one(
        "backup",
        "Back up",
        "Copy the store as it is now, so the migration can be rolled back to it",
        "store.backup",
        {},
      ),
      {
        ...one(
          "preview",
          "Preview",
          "Plan the migration and record what it will write, pinning the backup",
          "migration.preview",
        ),
        changes: plan,
      },
      {
        ...one(
          "apply",
          "Apply",
          "Write the previewed plan as one transaction, if the store still plans the same",
          "migration.apply",
        ),
        changes: plan,
      },
      one(
        "verify",
        "Verify",
        "Check the migrated store and record what is wrong with it",
        "migration.verify",
      ),
      {
        id: "decide",
        title: "Keep or roll back",
        description:
          "After a trial, keep the migration (its backup is then an ordinary one) or put the store back to the backup taken before it",
        actions: [
          { id: "keep", title: "Keep", call: { action: "migration.keep", input: on } },
          {
            id: "rollback",
            tone: "destructive",
            title: "Roll back",
            call: { action: "migration.rollback", input: on },
          },
        ],
        check: check("decide"),
      },
    ],
  };
}
