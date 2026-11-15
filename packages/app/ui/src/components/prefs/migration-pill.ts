/**
 * A data migration's state pill in Settings → Extensions → Migrations
 * (DESIGN-UI.md → Settings): its record's state, else pending or nothing
 * to do, in the extension cards' pill face.
 */
import type { MigrationState } from "@kb/model";
import type { MigrationRow } from "@/stores/migrations.store";
import type { PillFace } from "./pill";

/** A record's state in words: the option set's, with its hyphen read as a space. */
const STATE_WORDS: Readonly<Record<MigrationState, string>> = {
  previewed: "previewed",
  applied: "applied",
  verified: "verified",
  failed: "failed",
  kept: "kept",
  "rolled-back": "rolled back",
};

const TONES = {
  destructive: { tone: "bg-destructive/10", dot: "bg-destructive" },
  warning: { tone: "bg-warning/10", dot: "bg-warning" },
  quiet: { tone: "bg-foreground/5", dot: "bg-faint-foreground" },
} as const;

/** A migration's pill: its record's state, else pending or nothing to do, toned by what it asks. */
export function migrationPill(m: MigrationRow): PillFace {
  const word =
    m.state !== null
      ? STATE_WORDS[m.state]
      : m.problem !== undefined
        ? "cannot plan"
        : m.pending
          ? "pending"
          : "nothing to do";
  const tone =
    m.state === "failed" || m.problem !== undefined
      ? "destructive"
      : m.pending
        ? "warning"
        : "quiet";
  return { word, ...TONES[tone] };
}
