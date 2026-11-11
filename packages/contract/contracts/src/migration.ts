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
import { Point } from "@kb/plugin";
import type { KbNode, NodeId } from "@kb/model";
import { CORE_POINT_DEFINITIONS } from "./point-definitions.ts";
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
export interface MigrationPlan {
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
      one(
        "preview",
        "Preview",
        "Plan the migration and record what it will write, pinning the backup",
        "migration.preview",
      ),
      one(
        "apply",
        "Apply",
        "Write the previewed plan as one transaction, if the store still plans the same",
        "migration.apply",
      ),
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
            title: "Roll back",
            call: { action: "migration.rollback", input: on },
          },
        ],
        check: check("decide"),
      },
    ],
  };
}
