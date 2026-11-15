/**
 * What Settings → Extensions → Migrations draws (DESIGN-UI.md → Settings):
 * a card's pill, its line and the button that opens its procedure page,
 * and what the group says while its list is unread or empty. Nothing here
 * runs a step.
 */
import { migrationProcedureId } from "@kb/contracts";
import { navigate } from "@kb/ui-sdk";
import { readMigrations, type MigrationRow } from "@/stores/migrations.store";
import { BUTTON } from "./extension-actions";
import { migrationPill } from "./migration-pill";
import { Pill } from "./pill";

/** A migration's state pill, found by its state (or, with none, its word). */
export function MigrationPill({ migration }: { readonly migration: MigrationRow }) {
  const face = migrationPill(migration);
  return <Pill face={face} data={{ "data-migration-state": migration.state ?? face.word }} />;
}

/** What a migration would do now, in one line: its id and its change count, or why it cannot plan. */
export function MigrationLine({ migration }: { readonly migration: MigrationRow }) {
  return (
    <p className="py-1 text-meta text-muted-foreground">
      <code className="font-mono">{migration.id}</code>
      {migration.problem !== undefined ? (
        <span className="text-destructive"> · cannot plan: {migration.problem}</span>
      ) : (
        <span className="text-faint-foreground">
          {" "}
          · {migration.changes} {migration.changes === 1 ? "node" : "nodes"} to write now
        </span>
      )}
    </p>
  );
}

/** The button that opens a migration's procedure page, where its steps are taken. */
export function OpenProcedure({ migration }: { readonly migration: MigrationRow }) {
  return (
    <button
      type="button"
      className={BUTTON}
      data-migration-open={migration.id}
      aria-label={`${migration.pending ? "Review" : "Open"} ${migration.title}`}
      onClick={() =>
        navigate(`/procedure/${encodeURIComponent(migrationProcedureId(migration.id))}`)
      }
    >
      {migration.pending ? "Review" : "Open"}
    </button>
  );
}

/** Why the list is not drawn, with a way to read it again. */
export function MigrationsUnread({ problem }: { readonly problem: string | null }) {
  return (
    <p
      className="flex flex-wrap items-center gap-2 py-1 text-meta text-muted-foreground"
      role={problem === null ? undefined : "alert"}
      data-testid="migrations-unread"
    >
      {problem === null ? "Reading the migrations…" : `Could not read the migrations: ${problem}`}
      {problem === null ? null : (
        <button type="button" className={BUTTON} onClick={() => void readMigrations()}>
          Read again
        </button>
      )}
    </p>
  );
}

/** What the group says when no family declares a migration. */
export function MigrationsEmpty() {
  return (
    <p
      className="rounded-md border border-dashed border-border px-3 py-4 text-meta text-muted-foreground"
      data-testid="migrations-empty"
    >
      No family declares a data migration.
    </p>
  );
}
