/**
 * The seed's retirement table (DESIGN.md → Extension families → the seed
 * retires what it renames): a seeded id a store may still hold, and the
 * seeded id that took its place, if any. A declaration lists its own rows
 * (`SeedSource.retires`), the fold carries every row as it carries the seed
 * nodes (`FoldedSeed.retired`), and opening a store applies them before it
 * seeds (`ensureSystemSeed`), so a rename is one row, never a special case.
 *
 * A row retires one id, whatever it names: a renamed field and each of its
 * options are rows of their own, so a value that chose an old option
 * chooses its replacement, and a prop keyed by an old field is keyed by its
 * replacement.
 *
 * A row may also retire a label: the text the seed wrote on `from` before
 * it changed it (`text`). Where the node, under `to`, still reads that text,
 * nobody edited it, so it takes the text the seed writes now; where it reads
 * anything else, that is the owner's edit and stays. A label changed under
 * the same id is a row whose `to` is its `from`.
 *
 * The table is idempotent: it applies wherever a retired id or label is
 * present and does nothing where none is, so a store a build without the
 * row re-seeded (the old node back, nothing choosing it) is retired again
 * on the next open, and a store retired once is left alone after.
 */
import type { NodeId } from "./model.ts";

/**
 * One row: `from` is retired; `to`, when given, is the seeded id that
 * replaced it (`from` itself where only the label changed); `text`, when
 * given, is the label the seed wrote on `from` before.
 */
export interface SeedRetirement {
  readonly from: NodeId;
  readonly to?: NodeId;
  readonly text?: string;
}
