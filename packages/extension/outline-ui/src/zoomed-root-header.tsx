import { useCallback } from "react";
import {
  cn,
  useFollow,
  useGraphRead,
  nodeTagColors,
  OptionChip,
  menuAnchor,
  pageTitleInstanceKey,
  type OutlineNode,
  routePointerClick,
  rowText,
  rowTextReadOnlyReason,
  schemaOf,
  TagChipGroup,
  UNTAGGED_COLOR,
  useOpenNode,
  usePageGraph,
} from "@kb/ui-sdk";
import { isQueryNode } from "@kb/model";
import { projectsRows, type FrameViewKey } from "@kb/views";
import { FieldsSection } from "./fields-section";
import { ViewToolbar } from "./view-toolbar";
import { NodeContent } from "./node-content";
import { useOutlineStore } from "./outline.store";
import { createFirstChild } from "./editing-writes";
import { takesRows } from "./takes-rows";

/**
 * D13: everything is a node — the zoomed page title edits in place with
 * header typography, a system node's too: its label is the person's. Only
 * what the row rule refuses (`rowTextReadOnlyReason`) stays read-only.
 */
function EditableTitle({
  node,
  onEnter,
}: {
  node: OutlineNode;
  /** What Enter does after it ends the edit: open a first row, on a page that takes rows. */
  onEnter?: (() => void) | undefined;
}) {
  const schema = usePageGraph(schemaOf);
  const { isVirtual } = useGraphRead();
  // The same text channel as a row: what it shows and whether it can be
  // written are the row rules (`lib/contextual-ref`), not a second copy.
  const readOnly = rowTextReadOnlyReason(node.id, node, schema, isVirtual) !== null;
  const text = rowText(node, schema);
  // Its edit is the page editor's, as a row's is: activated under its own
  // instance, so the page (and every backdrop reading `editing()`) knows the
  // owner is typing, and ended when that instance stops being the active one.
  const key = pageTitleInstanceKey(node.id);
  const editing = useOutlineStore((s) => s.activeInstanceKey === key);
  const startEditing = useCallback(() => {
    const store = useOutlineStore.getState();
    store.activateNode(node.id, undefined, key);
    store.placeCaret(key, "end");
  }, [node.id, key]);
  const commit = useCallback(() => {
    const store = useOutlineStore.getState();
    if (store.activeInstanceKey === key) store.deactivateNode();
  }, [key]);

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
        instanceKey={key}
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
            onEnter?.();
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
        startEditing();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          startEditing();
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
  "kb-display kb-text-row min-h-9 min-w-0 flex-1 px-1 py-1",
  "text-title font-semibold leading-[1.4]",
);

/**
 * Who seeds the page's node, when the graph says (`GraphRead.ownerOf`): its
 * owner's node, drawn as a chip for a node is and followed as a reference is.
 * What the owner ships of the node stays as it shipped it; the label, a
 * person's children and fields, and its settings are the person's.
 */
function OwnedBy({ id }: { id: string }) {
  // The owner is named as a ref value is, against the whole graph: a scope
  // that lists this node need not list the family that seeds it.
  const { ownerOf, schema } = useGraphRead();
  const follow = useFollow();
  const ownerId = ownerOf(id);
  const owner = ownerId === null ? undefined : schema.get(ownerId);
  if (owner === undefined) return null;
  return (
    <div
      className="flex items-center gap-1 text-meta text-muted-foreground"
      role="presentation"
      data-owned-by={owner.id}
      onClick={(e) => {
        routePointerClick(e, follow);
      }}
    >
      <span>Owned by</span>
      <OptionChip
        id={owner.id}
        label={owner.text || owner.id}
        color={nodeTagColors(owner)[0] ?? UNTAGGED_COLOR}
      />
    </div>
  );
}

/** Zoomed root title + fields at depth −1 (DESIGN-RESKIN §1.5), under the page head's space. */
export function ZoomedRootHeader({
  node,
  view,
}: {
  readonly node: OutlineNode;
  /** The view the node shows its children in, as its host resolved it (`frameViewOf`). */
  readonly view: FrameViewKey | null;
}) {
  const zoomTo = useOpenNode();
  const isList = !projectsRows(view);
  // A query page's control holds its query, one click away: never behind the gear.
  const tucked = isList && !isQueryNode(node);

  return (
    <div
      className="zoomed-root-header px-2 pb-2"
      data-zoomed-root-header="true"
      data-frame-id={node.id}
    >
      {/* Under the head's space (`PageBackdrop`, the outline editor's), whose backdrop reaches behind it. */}
      <div className="relative pl-7">
        <div
          className="group/header flex min-h-9 items-start justify-between gap-2"
          {...menuAnchor(pageTitleInstanceKey(node.id))}
        >
          <EditableTitle
            node={node}
            onEnter={takesRows(node, view) ? () => void createFirstChild(node.id) : undefined}
          />
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

        {/* Its tags and its owner: hidden when it has neither. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-2 empty:hidden">
          {node.tags.length > 0 && (
            <TagChipGroup
              tags={node.tags}
              onTagClick={(tag, e) => {
                e.stopPropagation();
                zoomTo(tag.id);
              }}
            />
          )}
          <OwnedBy id={node.id} />
        </div>
      </div>

      <FieldsSection nodeId={node.id} depth={-1} instanceKey={`title/${node.id}`} />
    </div>
  );
}
