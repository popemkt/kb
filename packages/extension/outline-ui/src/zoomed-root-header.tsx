import { useCallback, useState } from "react";
import { LockSimpleIcon } from "@phosphor-icons/react";
import {
  cn,
  isSysPrefixed,
  nodeTagColors,
  type OutlineNode,
  rowText,
  rowTextReadOnlyReason,
  schemaOf,
  TagChipGroup,
  useOpenNode,
  usePageGraph,
  PageBackdrop,
} from "@kb/ui-sdk";
import { isQueryNode } from "@kb/model";
import { projectsRows, type FrameViewKey } from "@kb/views";
import { FieldsSection } from "./fields-section";
import { ViewToolbar } from "./view-toolbar";
import { NodeContent } from "./node-content";

/**
 * D13: everything is a node — the zoomed page title edits in place with
 * header typography. sys.* roots stay read-only behind a padlock.
 */
function EditableTitle({ node }: { node: OutlineNode }) {
  const schema = usePageGraph(schemaOf);
  // The same text channel as a row: what it shows and whether it can be
  // written are the row rules (`lib/contextual-ref`), not a second copy.
  const readOnly = rowTextReadOnlyReason(node.id, node, schema) !== null;
  const [editing, setEditing] = useState(false);
  const text = rowText(node, schema);

  const commit = useCallback(() => setEditing(false), []);

  if (readOnly) {
    return (
      <h1
        title={`${text || "Untitled"} (system, read-only)`}
        className={cn(TITLE_CLASS, "text-foreground/60")}
        data-zoom-title-readonly="true"
      >
        {text || "Untitled"}
      </h1>
    );
  }

  if (editing) {
    return (
      <NodeContent
        node={node}
        instanceKey={`title/${node.id}`}
        isActive
        tags={[]}
        initialCaret="end"
        textClassName={cn(TITLE_CLASS, "rounded-sm text-foreground/90")}
        onActivate={() => undefined}
        onBlur={commit}
        zoomTitleEditor
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commit();
          }
        }}
      />
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          setEditing(true);
        }
      }}
      className={cn(
        TITLE_CLASS,
        "cursor-text text-foreground/90",
        "rounded-sm transition-colors duration-100 hover:text-foreground",
        !text && 'empty:before:content-["Untitled"]',
      )}
      data-zoom-title="true"
    >
      {text || <br />}
    </div>
  );
}

/**
 * The page heading wraps, every line of it, in view and in edit alike: it is
 * row text (`kb-text-row`, pre-wrap) at the title step. Truncation belongs to
 * the places that are short of room — breadcrumbs, the sidebar — which keep
 * the full text in a tooltip. One line is the height of the side controls'
 * box (`h-9`), so they sit level with the first line however many follow.
 */
const TITLE_CLASS = cn(
  "kb-text-row min-h-9 min-w-0 flex-1 px-1 py-1",
  "text-title font-semibold leading-[1.4]",
);

/** Zoomed root title + tag wash + fields at depth −1 (DESIGN-RESKIN §1.5). */
export function ZoomedRootHeader({
  node,
  view,
}: {
  readonly node: OutlineNode;
  /** The view the node shows its children in, as its host resolved it (`frameViewOf`). */
  readonly view: FrameViewKey | null;
}) {
  const zoomTo = useOpenNode();
  // Ambient wash, not an identity readout: one color is enough, but which
  // color and how it weakens both come from the tag-color owner.
  const washColor = nodeTagColors(node)[0] ?? null;
  const isList = !projectsRows(view);
  // A query page's control holds its query, one click away: never behind the gear.
  const tucked = isList && !isQueryNode(node);

  return (
    <div
      className="zoomed-root-header px-2 pb-2 pt-1"
      data-zoomed-root-header="true"
      data-frame-id={node.id}
    >
      <div className="relative pl-7 pt-1">
        <PageBackdrop color={washColor ?? "var(--primary)"} node={node} />

        <div className="group/header relative flex min-h-9 items-start justify-between gap-2">
          <EditableTitle node={node} />
          {isSysPrefixed(node.id) && (
            <span
              className="flex h-9 shrink-0 items-center text-foreground/30"
              title="System node — read-only"
              data-sys-lock="true"
            >
              <LockSimpleIcon size={14} weight="bold" />
            </span>
          )}
          {/* A list frame keeps its view control quiet: it shows on hover or
              keyboard focus, and stays while something it opened is open. A
              plain list tucks it behind one gear; a query's shows its toolbar,
              whose Query button opens the builder. A projected view shows its
              toolbar outright. */}
          <span
            className={cn(
              "flex h-9 shrink-0 items-center transition-opacity duration-100",
              isList &&
                "opacity-0 focus-within:opacity-100 group-hover/header:opacity-100 has-[[aria-expanded=true]]:opacity-100",
              tucked && "has-[[data-view-toolbar]]:opacity-100",
            )}
            data-view-control="true"
          >
            <ViewToolbar frameId={node.id} view={view} tucked={tucked} />
          </span>
        </div>

        {node.tags.length > 0 && (
          <div className="relative flex items-center gap-1 pb-2">
            <TagChipGroup
              tags={node.tags}
              onTagClick={(tag, e) => {
                e.stopPropagation();
                zoomTo(tag.id);
              }}
            />
          </div>
        )}
      </div>

      <FieldsSection nodeId={node.id} depth={-1} instanceKey={`title/${node.id}`} />
    </div>
  );
}
