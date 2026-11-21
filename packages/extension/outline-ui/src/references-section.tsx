import { useState } from "react";
import { CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react";
import {
  childInstanceKey,
  NodeLinkRow,
  projectedRowKey,
  schemaOf,
  shownNode,
  useAnswered,
  useGraphRead,
  usePageGraph,
} from "@kb/ui-sdk";
import { backlinkRows, type BacklinkRow } from "./backlinks";
import { NodeBlock } from "./node-block";
import { useOutlineHost } from "./outline-host";
import { RowBreadcrumbs } from "./row-breadcrumbs";
import { useReferencesScroll } from "./references-scroll";
import { SectionHeading } from "./section-heading";
import { UnlinkedMentionsSection } from "./unlinked-mentions";

export function ReferencesSection({ nodeId }: { nodeId: string }) {
  const schema = usePageGraph(schemaOf);
  const index = usePageGraph((s) => s.index);
  const { value: backlinks } = useAnswered(
    (run) => backlinkRows(run, schema, index, nodeId),
    [nodeId, schema, index],
  );

  const section = useReferencesScroll(nodeId);
  // The same referrer can also be a result in this page or visible in another pane.
  const parentKey = projectedRowKey(useOutlineHost(), "references", nodeId);
  return (
    <>
      {backlinks.length > 0 && (
        <section ref={section} className="references-section" data-references-for={nodeId}>
          <SectionHeading count={backlinks.length}>References</SectionHeading>
          {backlinks.map((row) => (
            <ReferenceItem key={row.id} row={row} parentKey={parentKey} />
          ))}
        </section>
      )}
      <UnlinkedMentionsSection nodeId={nodeId} />
    </>
  );
}

function ReferenceItem({ row, parentKey }: { row: BacklinkRow; parentKey: string }) {
  const { outline, schema } = useGraphRead();
  const [expanded, setExpanded] = useState(false);
  const referrer = outline.get(row.id) ?? schema.get(row.id);
  const children =
    referrer === undefined
      ? []
      : shownNode(referrer, schema).children.filter((id) => outline.has(id));
  const canExpand = children.length > 0;
  const Caret = expanded ? CaretDownIcon : CaretRightIcon;
  const instanceKey = childInstanceKey(parentKey, row.id);
  return (
    <div data-backlink-id={row.id}>
      <RowBreadcrumbs crumbs={row.breadcrumbs} />
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <NodeLinkRow
            id={row.id}
            text={row.text}
            tags={row.tags}
            leading={row.relations.map((relation) => (
              <span
                key={relation.field}
                className="shrink-0 rounded-xs bg-foreground/[0.05] px-1.5 py-0.5 text-caption text-foreground/50"
                data-backlink-relation={relation.field}
              >
                {relation.label}
              </span>
            ))}
          />
        </div>
        {canExpand && (
          <button
            type="button"
            aria-label={
              expanded ? "Hide referring node’s children" : "Show referring node’s children"
            }
            aria-expanded={expanded}
            className="shrink-0 rounded-sm p-1 text-foreground/55 hover:bg-foreground/5 hover:text-foreground cursor-pointer"
            onClick={() => setExpanded((open) => !open)}
          >
            <Caret size={14} />
          </button>
        )}
      </div>
      {expanded &&
        children.map((id) => (
          <NodeBlock
            key={id}
            nodeId={id}
            depth={1}
            instanceKey={childInstanceKey(instanceKey, id)}
          />
        ))}
    </div>
  );
}
