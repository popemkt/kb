/**
 * The header's line while any data migration is pending (DESIGN-UI.md →
 * Settings → Migrations ready to review): how many, linking to Settings →
 * Extensions → Migrations, and a button that dismisses it for this session.
 */
import { XIcon } from "@phosphor-icons/react";
import { navigate } from "@kb/ui-sdk";
import { MIGRATIONS_ANCHOR, settingsPath } from "@/lib/settings-parts";
import { dismissMigrations, useMigrationsToReview } from "@/stores/migrations.store";

const MIGRATIONS_PATH = settingsPath("extensions", MIGRATIONS_ANCHOR);

/** The line; it never opens anything by itself. */
export function MigrationsNote() {
  const toReview = useMigrationsToReview();
  if (toReview.length === 0) return null;
  const n = toReview.length;
  const count = `${n} ${n === 1 ? "migration" : "migrations"}`;
  const words = `${count} ready to review`;
  return (
    <span
      className="flex shrink-0 items-center text-label whitespace-nowrap text-faint-foreground"
      data-migrations-note={toReview.length}
    >
      <a
        href={MIGRATIONS_PATH}
        aria-label={words}
        title={words}
        className="rounded-sm px-1 underline-offset-2 hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          navigate(MIGRATIONS_PATH);
        }}
      >
        {count}
        {/* A narrow header keeps the count, on one line; the name says it whole. */}
        <span className="hidden sm:inline"> ready to review</span>
      </a>
      <button
        type="button"
        aria-label="Dismiss for this session"
        title="Dismiss for this session"
        className="flex size-6 touch-manipulation items-center justify-center rounded-sm hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => dismissMigrations(toReview.map((m) => m.id))}
      >
        <XIcon size={11} aria-hidden />
      </button>
    </span>
  );
}
