import { useState } from "react";
import {
  browserHost,
  NodeLinkRow,
  OutlineLine,
  schemaOf,
  useAnswered,
  useLastSettled,
  usePageGraph,
} from "@kb/ui-sdk";
import { RowBreadcrumbs } from "./row-breadcrumbs";
import { SectionHeading } from "./section-heading";
import { unlinkedMentionRows, type UnlinkedMentionRow } from "./unlinked-mentions-model";

const PAGE_SIZE = 50;

function linkMention({ node, linkedText }: UnlinkedMentionRow) {
  void browserHost().writes.setNodeText(node.id, linkedText, node.text);
}

export function UnlinkedMentionsSection({ nodeId }: { readonly nodeId: string }) {
  const schema = usePageGraph(schemaOf);
  const answer = useAnswered((run) => unlinkedMentionRows(run, schema, nodeId), [nodeId, schema]);
  const mentions = useLastSettled(answer, nodeId);
  const index = usePageGraph((state) => state.index);
  const [limit, setLimit] = useState(PAGE_SIZE);

  if (mentions === null || mentions.length === 0) return null;
  const visible = mentions.slice(0, limit);
  const remaining = mentions.length - visible.length;
  return (
    <section data-unlinked-mentions-for={nodeId}>
      <SectionHeading count={mentions.length}>Unlinked mentions</SectionHeading>
      {visible.map((row) => (
        <div key={row.node.id} data-unlinked-mention-id={row.node.id}>
          <RowBreadcrumbs crumbs={row.breadcrumbs} />
          <div className="flex items-center gap-1.5">
            <div className="min-w-0 flex-1">
              <NodeLinkRow id={row.node.id} text={row.node.text} tags={row.node.tags} />
            </div>
            <button
              type="button"
              className="shrink-0 rounded-xs border border-border/60 bg-foreground/[0.03] px-2 py-0.5 text-caption font-medium text-foreground/70 hover:bg-foreground/[0.08] hover:text-foreground transition-colors duration-100 cursor-pointer"
              data-link-mention={row.node.id}
              disabled={!answer.settled || index?.isVirtual(row.node.id) === true}
              onClick={() => linkMention(row)}
            >
              Link
            </button>
          </div>
        </div>
      ))}
      {remaining > 0 && (
        <OutlineLine
          depth={0}
          className="mt-1"
          text={
            <button
              type="button"
              className="rounded-sm px-2 py-1 text-caption text-foreground/60 hover:bg-foreground/5 hover:text-foreground transition-colors duration-100 cursor-pointer"
              onClick={() => setLimit((n) => n + PAGE_SIZE)}
            >
              Show more ({remaining} remaining)
            </button>
          }
        />
      )}
    </section>
  );
}
