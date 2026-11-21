import { useCallback, useEffect, useRef } from "react";
import {
  cn,
  useFollow,
  useGraphRead,
  nodeTagColors,
  OptionChip,
  menuAnchor,
  nameIn,
  OutlineLine,
  pageTitleInstanceKey,
  type OutlineNode,
  routePointerClick,
  InlineMarkdown,
  refLookOf,
  rowName,
  rowTitle,
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
  // At rest the title is the row's display text, rich: what a row draws at
  // rest, its references as pills (DESIGN.md → Display text).
  const title = rowTitle(node, schema);
  const name = rowName(node, schema);
  const follow = useFollow();
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

  // The title selected is the page's node selected: it holds the keyboard,
  // so Enter edits it and the page's keys act from it. Opening a node from
  // ⌘K selects it there (DESIGN-UI.md → Node pages).
  const selected = useOutlineStore(
    (s) => s.selectedInstanceKey === key && s.activeInstanceKey === null,
  );
  const restingTitle = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) restingTitle.current?.focus({ preventScroll: true });
  }, [selected]);

  if (readOnly) {
    return (
      <h1
        title={`${name || "Untitled"} (system, read-only)`}
        className={cn(TITLE_CLASS, "text-foreground/60")}
        data-zoom-title-readonly="true"
        onClick={(e) => routePointerClick(e, follow)}
      >
        {title ? <InlineMarkdown text={title} refs={refLookOf(schema)} /> : "Untitled"}
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
      ref={restingTitle}
      role="button"
      tabIndex={0}
      onClick={(e) => {
        // A reference in the title is followed, as in a row; the rest edits.
        if (routePointerClick(e, follow)) return;
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
        !title && 'empty:before:content-["Untitled"]',
      )}
      data-zoom-title="true"
    >
      {title ? <InlineMarkdown text={title} refs={refLookOf(schema)} /> : <br />}
    </div>
  );
}

/**
 * The page heading wraps, every line of it, in view and in edit alike: it is
 * row text (`kb-text-row`, pre-wrap) at the title step. Truncation belongs to
 * the places that are short of room — breadcrumbs, the sidebar — which keep
 * the full text in a tooltip. It owns its line (DESIGN-UI.md → Outline
 * layout, the page's title): nothing sits beside it, so it wraps only where
 * the column ends. Its text starts on the text column, as a row's does.
 */
const TITLE_CLASS = cn(
  "kb-display kb-text-row min-h-9 min-w-0 py-1",
  "text-title font-semibold leading-[1.4]",
);

/**
 * Who seeds the page's node, when the graph says (`GraphRead.ownerOf`): its
 * owner's node, drawn as a chip for a node is and followed as a reference is.
 * What the owner ships of the node stays as it shipped it; the label, a
 * person's children and fields, and its settings are the person's.
 */
function useOwner(id: string) {
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
        label={nameIn(schema, owner.id) || owner.id}
        color={nodeTagColors(owner)[0] ?? UNTAGGED_COLOR}
      />
    </div>
  );
}

/**
 * The page's head, under its space (DESIGN-UI.md → Outline layout, the
 * page's title): the title, its tags and owner, and its view control, each
 * a line of the outline at depth 0 with an empty glyph column, so each
 * starts on the text column the page's rows start on. Its fields follow as
 * depth-0 field rows (DESIGN-RESKIN §1.5).
 */
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
  const owner = useOwner(node.id);

  return (
    <div
      className="zoomed-root-header group/header pb-2"
      data-zoomed-root-header="true"
      data-frame-id={node.id}
    >
      {/* Under the head's space (`PageBackdrop`, the outline editor's), whose backdrop reaches behind it. */}
      <OutlineLine
        depth={0}
        text={
          <EditableTitle
            node={node}
            onEnter={takesRows(node, view) ? () => void createFirstChild(node.id) : undefined}
          />
        }
        {...menuAnchor(pageTitleInstanceKey(node.id))}
      />

      {/* Its tags and its owner: no line when it has neither. */}
      {(node.tags.length > 0 || owner !== null) && (
        <OutlineLine
          depth={0}
          textClassName="flex flex-wrap items-center gap-x-3 gap-y-1 pb-1"
          text={
            <>
              {node.tags.length > 0 && (
                <TagChipGroup
                  tags={node.tags}
                  onTagClick={(tag, e) => {
                    e.stopPropagation();
                    zoomTo(tag.id);
                  }}
                />
              )}
              {owner}
            </>
          }
        />
      )}

      {/* Its view control, on a line of its own. A list page keeps it quiet,
          one gear that shows on hover or keyboard focus and stays while
          something it opened is open; a query's shows its toolbar, whose
          Query button opens the builder, and a projected view shows its
          toolbar outright. The toolbar's width is its line's
          (`@container/viewbar`): narrow, its views show glyphs only. */}
      <OutlineLine
        depth={0}
        textClassName="@container/viewbar"
        text={
          <span
            className={cn(
              "flex min-h-6 max-w-full items-center transition-opacity duration-100",
              isList &&
                "opacity-0 focus-within:opacity-100 group-hover/header:opacity-100 has-[[aria-expanded=true]]:opacity-100",
              tucked && "has-[[data-view-toolbar]]:opacity-100",
            )}
            data-view-control="true"
          >
            <ViewToolbar frameId={node.id} view={view} tucked={tucked} />
          </span>
        }
      />

      <FieldsSection nodeId={node.id} depth={-1} instanceKey={`title/${node.id}`} />
    </div>
  );
}
