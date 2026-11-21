import { browserHost, NodeLinkRow } from "@kb/ui-sdk";
import type { UnlinkedMentionRow } from "./unlinked-mentions-model";

function linkMention({ node, linkedText }: UnlinkedMentionRow) {
  void browserHost().writes.setNodeText(node.id, linkedText, node.text);
}

/**
 * An unlinked mention: the row that names the node in plain text, and its
 * Link, which turns the matched words into a reference. Link is the row's
 * action, so it shows on hover or focus without moving the row's words.
 */
export function MentionRow({
  row,
  depth,
  linkable,
}: {
  readonly row: UnlinkedMentionRow;
  readonly depth: number;
  /** Whether the match is read from settled text the write may name. */
  readonly linkable: boolean;
}) {
  return (
    <div data-unlinked-mention-id={row.node.id}>
      <NodeLinkRow
        id={row.node.id}
        text={row.node.text}
        tags={row.node.tags}
        depth={depth}
        action={
          <button
            type="button"
            className="rounded-xs border border-border/60 bg-background px-2 py-0.5 text-caption font-medium text-foreground/70 hover:bg-foreground/[0.08] hover:text-foreground transition-colors duration-100 cursor-pointer"
            data-link-mention={row.node.id}
            title="Turn the matched words into a reference"
            disabled={!linkable}
            onClick={() => linkMention(row)}
          >
            Link
          </button>
        }
      />
    </div>
  );
}
