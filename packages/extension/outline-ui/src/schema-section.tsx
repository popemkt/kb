import { useOutlineStore, useOutlineNode, useOutlineNodes } from "./outline.store";
import {
  usePageGraph,
  schemaOf,
  rowTitle,
  browserHost,
  Bullet,
  MdView,
  NodeRow,
  OutlineLine,
  queryFieldCarriers,
  queryTaggedInstances,
  type SchemaHit,
  schemaZoomKind,
  TagChipGroup,
  useAnswered,
  useFollow,
  useOpenNode,
  useRefLook,
} from "@kb/ui-sdk";
import { SectionHeading } from "./section-heading";
import { TagFieldsConfig } from "./tag-fields-config";

/**
 * When zoomed into a tag or field definition, show live schema instances
 * (Tana "Everything tagged #X" / nodes carrying the field).
 */
export function SchemaSection({ nodeId }: { nodeId: string }) {
  const node = useOutlineNode(nodeId);
  const jumpToNode = useOutlineStore((s) => s.jumpToNode);
  const zoomTo = useOpenNode();

  const kind = schemaZoomKind(node);

  const { value: hits, settled } = useAnswered(
    (run): SchemaHit[] => {
      if (!kind) return [];
      return kind === "tag" ? queryTaggedInstances(run, nodeId) : queryFieldCarriers(run, nodeId);
    },
    [nodeId, kind],
  );

  if (!kind) return null;

  const title = kind === "tag" ? "Tagged instances" : "Nodes with this field";

  return (
    <section className="mt-6 border-t border-foreground/[0.06] pt-4">
      {kind === "tag" && <TagFieldsConfig tagId={nodeId} />}
      <SectionHeading count={hits.length}>{title}</SectionHeading>
      {hits.length === 0 ? (
        <OutlineLine
          depth={0}
          role="status"
          aria-busy={!settled}
          textClassName="text-ui text-foreground/50"
          text={settled ? "None yet" : "Loading…"}
        />
      ) : (
        hits.map((hit) => (
          <SchemaInstanceRow
            key={hit.id}
            hit={hit}
            onActivate={() => {
              browserHost().zoomHome();
              jumpToNode(hit.id);
            }}
            onZoom={() => zoomTo(hit.id)}
          />
        ))
      )}
    </section>
  );
}

function SchemaInstanceRow({
  hit,
  onActivate,
  onZoom,
}: {
  hit: SchemaHit;
  onActivate: () => void;
  onZoom: () => void;
}) {
  const nodes = useOutlineNodes();
  const follow = useFollow();
  const refs = useRefLook();
  const schema = usePageGraph(schemaOf);
  const node = nodes.get(hit.id);
  const tags = node?.tags ?? [];

  const bulletNode = node ?? {
    id: hit.id,
    text: hit.text,
    parentId: null,
    children: [],
    collapsed: true,
    props: {},
    createdAt: "",
    updatedAt: "",
    tags,
  };

  return (
    <div onDoubleClick={onZoom}>
      <NodeRow
        depth={0}
        nodeId={hit.id}
        className="w-full cursor-pointer text-left"
        onRowClick={onActivate}
        bullet={
          <Bullet
            node={bulletNode}
            isRef
            onClick={(e) => {
              e.stopPropagation();
              onZoom();
            }}
          />
        }
        content={
          <>
            <MdView
              text={rowTitle(bulletNode, schema) || "(empty)"}
              className="min-w-0 flex-1 text-foreground/85"
              onFollow={follow}
              refs={refs}
            />
            {tags.length > 0 && (
              <TagChipGroup
                tags={tags}
                onTagClick={(_tag, e) => {
                  e.stopPropagation();
                  onZoom();
                }}
              />
            )}
          </>
        }
      />
    </div>
  );
}
