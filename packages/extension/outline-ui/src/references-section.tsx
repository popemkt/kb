import { backlinkRows, type BacklinkRow } from "./backlinks";
import { NodeLinkRow, schemaOf, useAnswered, usePageGraph } from "@kb/ui-sdk";

/**
 * Inline "References (N)" at the bottom of a zoomed view (DESIGN-RESKIN §1.5).
 */
export function ReferencesSection({ nodeId }: { nodeId: string }) {
  const schema = usePageGraph(schemaOf);
  const index = usePageGraph((s) => s.index);
  const { value: backlinks } = useAnswered(
    (run): BacklinkRow[] => backlinkRows(run, schema, index, nodeId),
    [nodeId, schema, index],
  );

  return <ReferencesView nodeId={nodeId} backlinks={backlinks} />;
}

export function ReferencesView({
  nodeId,
  backlinks,
}: {
  nodeId: string;
  backlinks: BacklinkRow[];
}) {
  if (backlinks.length === 0) return null;

  return (
    <section className="references-section" data-references-for={nodeId}>
      <h2 className="mb-1 mt-3 text-meta kb-label text-foreground/30">
        References ({backlinks.length})
      </h2>
      {backlinks.map((row) => (
        <ShallowBacklinkRow key={row.id} row={row} />
      ))}
    </section>
  );
}

function ShallowBacklinkRow({ row }: { row: BacklinkRow }) {
  return (
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
  );
}
