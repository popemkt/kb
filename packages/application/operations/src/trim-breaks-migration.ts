/**
 * Core's migration `core.trim-trailing-breaks` (DESIGN.md → Plugin data
 * migrations, "Core's own migration"): the line breaks an earlier editor
 * stored at the end of node text, which nobody typed and each of which drew
 * an empty last line, come off. Inner line breaks stay. Pure and
 * idempotent: a graph with no such text plans nothing.
 */
import type { ExtensionMigration, MigrationGraph } from "@kb/contracts";

/** The line breaks that end a text: one or more, and nothing after them. */
const TRAILING_BREAKS = /\n+$/u;

/** `text` without the line breaks that end it. */
export function withoutTrailingBreaks(text: string): string {
  return text.replace(TRAILING_BREAKS, "");
}

const endsInBreak = (text: string): boolean => TRAILING_BREAKS.test(text);

export const trimBreaksMigration: ExtensionMigration = {
  id: "trim-trailing-breaks",
  title: "Trim stray trailing line breaks",
  description:
    "An earlier editor stored a line break nobody typed at the end of some nodes' text, which draws an empty last line. Each such text loses the line breaks that end it; the line breaks inside it stay.",
  run: (graph: MigrationGraph) => ({
    upserts: graph.nodes.flatMap((node) =>
      endsInBreak(node.text)
        ? [{ ...node, text: withoutTrailingBreaks(node.text), updatedAt: graph.at }]
        : [],
    ),
    deletes: [],
  }),
  check: (graph: MigrationGraph) =>
    graph.nodes
      .filter((node) => endsInBreak(node.text))
      .map((node) => `${node.id}'s text still ends in a line break`),
};
