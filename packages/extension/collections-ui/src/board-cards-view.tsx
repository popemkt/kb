import { memo, useCallback, useMemo, useState, type ComponentType, type Ref } from "react";
import { CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react";
import {
  browserHost,
  Bullet,
  bulletClickIntent,
  cn,
  type FieldContext,
  type FieldEditorProps,
  frameRows,
  type FrameSubject,
  isQueryResultInstance,
  isReferenceRow,
  type NodeMap,
  NodeRow,
  nodeTarget,
  type OutlineNode,
  type PropValue,
  resolveTableColumns,
  shownNode,
  shownNodeId,
  TagChipGroup,
  useDebugFields,
  useFieldEditor,
  useFollow,
  useGraphRead,
  useIsActive,
  useIsSelected,
  usePageGraph,
  usePrefs,
  BREAKOUT_CLASS,
  useBreakoutShift,
} from "@kb/ui-sdk";
import { laysOutLanes, localIdOf, type ParamsOf, type ViewFilter } from "@kb/views";
import { CollectionBoardView, CollectionCardsView } from "@kb/collections";
import { AddRow } from "./add-row";
import { groupWhere } from "./group-where";

/**
 * The two column views over one component: the board groups its cards into a
 * column per value of the field its params name, the cards view shows them
 * all in one grid.
 */
type ColumnsView =
  | {
      readonly key: typeof CollectionBoardView;
      readonly params: ParamsOf<typeof CollectionBoardView>;
    }
  | {
      readonly key: typeof CollectionCardsView;
      readonly params: ParamsOf<typeof CollectionCardsView>;
    };

interface BoardCardsViewProps {
  /** The frame the view lays out, and what its host draws each card with. */
  frame: FrameSubject;
  /** Which of the two views, with the settings it reads (`frameViewOf`). */
  view: ColumnsView;
  nodes?: NodeMap;
  /** What field values resolve against (`fieldContextOf`); the page's graph by default. */
  context?: FieldContext;
  widthPref?: "centered" | "full";
}

export function BoardCardsView({
  frame,
  view,
  nodes: nodesProp,
  context: contextProp,
  widthPref: widthPrefProp,
}: BoardCardsViewProps) {
  const { frameId, rowIds, isQuerySource, RowText, rowKey: instanceKeyFor } = frame;
  const Field = useFieldEditor();
  const generation = usePageGraph((s) => s.index?.generation ?? 0);
  const graph = useGraphRead();
  const storeNodes = graph.outline;
  const nodes = useMemo(
    () => nodesProp ?? storeNodes,
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- generation gates store map identity; the props path uses nodesProp
    [nodesProp, storeNodes, generation],
  );
  const frameNode = nodes.get(frameId);
  // Same rule as the table: displayed columns belong to the frame.
  const debugColumns = useDebugFields(frameId);
  const storeWidth = usePrefs((prefs) => prefs.width);
  const widthPref = widthPrefProp ?? storeWidth;

  // Column names and every field shown are schema, read from the whole graph
  // (`lib/schema.ts`), whatever projection the rows come from.
  const context = contextProp ?? graph;
  const schema = context.schema;

  // Grouping and order come from the shared owner: board columns and the flat
  // nav order are two views of one computation.
  const rows = useMemo(
    () => frameRows({ frameId, nodes, schema, view, rowIds }),
    [frameId, nodes, schema, view, rowIds],
  );
  const sorted = rows.ordered;
  const columns = rows.columns;
  const groupFieldId = rows.groupFieldId;
  const mode = localIdOf(view.key);

  const displayCols = useMemo(
    () => resolveTableColumns(view.params, sorted, schema, debugColumns),
    [view.params, sorted, schema, debugColumns],
  );

  const [dragNodeId, setDragNodeId] = useState<string | null>(null);
  const handleCardDragStart = useCallback((id: string) => {
    setDragNodeId(id);
  }, []);
  const handleCardDragEnd = useCallback(() => {
    setDragNodeId(null);
  }, []);

  const handleDropOnColumn = useCallback(
    (columnValue: PropValue | null) => {
      if (dragNodeId === null || groupFieldId === null || isQuerySource) return;
      void browserHost().writes.moveToGroup(dragNodeId, groupFieldId, columnValue);
      setDragNodeId(null);
    },
    [dragNodeId, groupFieldId, isQuerySource],
  );

  // A fold is a view setting: it is written to the view node, so every host
  // that names it shows the group folded (DESIGN-UI.md → Groups).
  const folded = "collapsed" in view.params ? view.params.collapsed : undefined;
  const toggleFold = useCallback(
    (key: string) => {
      if (folded === undefined) return;
      const next = folded.includes(key) ? folded.filter((held) => held !== key) : [...folded, key];
      void browserHost().writes.setFrameSetting(frameId, "collapsed", next);
    },
    [folded, frameId],
  );

  const breakout = view.key === CollectionBoardView && widthPref === "centered";
  const breakoutRef = useBreakoutShift(
    breakout && (frameNode !== undefined || rowIds !== undefined),
  );

  if (!frameNode && !rowIds) return null;

  if (laysOutLanes(view)) {
    return (
      <Lanes
        rows={rows.rendered}
        keyFor={instanceKeyFor}
        frame={frame}
        filters={view.params.filters}
        context={context}
        breakout={breakout}
        breakoutRef={breakoutRef}
      />
    );
  }

  return (
    <div
      ref={breakoutRef}
      className={cn(
        "board-cards-view my-2",
        // GAP [[01M7DAJSTW3PP7375FECAA2DHS]] nothing shows that the columns scroll on past the edge
        view.key === CollectionBoardView && "overflow-x-auto",
        breakout && [BREAKOUT_CLASS, "px-4"],
      )}
      data-board-cards-view="true"
      data-view-mode={mode}
      data-frame-id={frameId}
      data-breakout={breakout ? "centered" : undefined}
    >
      {view.key === CollectionCardsView ? (
        <div
          className="grid gap-2"
          style={{
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          }}
          data-cards-grid="true"
        >
          {(columns[0]?.nodes ?? []).map((child) => (
            <ViewCard
              key={instanceKeyFor(child.id)}
              child={child}
              instanceKey={instanceKeyFor(child.id)}
              displayCols={displayCols}
              context={context}
              RowText={RowText}
              Field={Field}
              draggable={false}
            />
          ))}
          <div className="self-start">
            <AddRow frame={frame} filters={view.params.filters} label="Add a card" />
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 min-w-max pb-2">
          {columns.map((col) => (
            <div
              key={col.key}
              className={cn(
                "shrink-0 rounded-md border border-foreground/[0.06] bg-foreground/[0.02]",
                col.collapsed ? "w-auto" : "w-64",
              )}
              data-board-column={col.key}
              data-collapsed={col.collapsed ? "true" : undefined}
              onDragOver={(e) => {
                if (isQuerySource || groupFieldId === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                e.preventDefault();
                handleDropOnColumn(col.value);
              }}
            >
              <GroupHeader
                label={col.label || "All"}
                count={col.nodes.length}
                collapsed={col.collapsed}
                onToggle={() => toggleFold(col.key)}
              />
              {col.collapsed ? null : (
                <div className="flex flex-col gap-2 p-2 min-h-16">
                  {col.nodes.map((child) => (
                    <ViewCard
                      key={instanceKeyFor(child.id)}
                      child={child}
                      instanceKey={instanceKeyFor(child.id)}
                      displayCols={displayCols}
                      context={context}
                      RowText={RowText}
                      Field={Field}
                      draggable={!isQuerySource && groupFieldId !== null}
                      onDragStart={handleCardDragStart}
                      onDragEnd={handleCardDragEnd}
                    />
                  ))}
                  <AddRow
                    frame={frame}
                    filters={view.params.filters}
                    where={groupWhere(groupFieldId, col.value)}
                    label={`Add to ${col.label || "All"}`}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A frame's rows as lanes (DESIGN-UI.md → Lanes): side by side, each the
 * row's own text over the rows under it, which the host draws as it draws
 * them under a row in a list (`RowChildren`), so a lane edits, nests and
 * walks as the list does.
 */
function Lanes({
  rows,
  keyFor,
  frame,
  filters,
  context,
  breakout,
  breakoutRef,
}: {
  rows: readonly OutlineNode[];
  keyFor: (nodeId: string) => string;
  frame: FrameSubject;
  filters: readonly ViewFilter[];
  context: FieldContext;
  breakout: boolean;
  breakoutRef: Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={breakoutRef}
      className={cn("board-cards-view my-2 overflow-x-auto", breakout && [BREAKOUT_CLASS, "px-4"])}
      data-board-cards-view="true"
      data-view-mode="board"
      data-lanes="true"
      data-frame-id={frame.frameId}
      data-breakout={breakout ? "centered" : undefined}
    >
      <div className="flex items-start gap-3 min-w-max pb-2">
        {rows.length === 0 && (
          <p className="w-64 rounded-md border border-dashed border-foreground/15 px-3 py-4 text-ui text-foreground/45">
            Each child of this node gets a lane here.
          </p>
        )}
        {rows.map((row) => (
          <Lane
            key={row.id}
            row={row}
            instanceKey={keyFor(row.id)}
            frame={frame}
            context={context}
          />
        ))}
        <div className="w-40 shrink-0">
          <AddRow frame={frame} filters={filters} label="Add a lane" />
        </div>
      </div>
    </div>
  );
}

/** One lane: its head row, then the rows under it, always shown. */
function Lane({
  row,
  instanceKey,
  frame,
  context,
}: {
  row: OutlineNode;
  instanceKey: string;
  frame: FrameSubject;
  context: FieldContext;
}) {
  const isActive = useIsActive(row.id, instanceKey);
  const isSelected = useIsSelected(row.id, instanceKey);
  const follow = useFollow();
  const shown = shownNode(row, context.schema);
  const { RowText, RowChildren } = frame;
  return (
    <div
      className="w-72 shrink-0 rounded-md border border-foreground/[0.06] bg-foreground/[0.02] pb-1"
      data-lane={row.id}
    >
      <div
        className="border-b border-foreground/[0.06] px-1 py-0.5 font-medium"
        data-lane-head="true"
      >
        <NodeRow
          depth={0}
          nodeId={row.id}
          instanceKey={instanceKey}
          isSelected={isSelected}
          isActive={isActive}
          onRowClick={() => browserHost().selectNode(row.id, instanceKey)}
          bullet={
            <Bullet
              node={shown}
              collapsed={false}
              collapsible={false}
              isRef={isReferenceRow(row, isQueryResultInstance(instanceKey))}
              onClick={(e) => {
                e.stopPropagation();
                // A lane always shows its rows, so its bullet opens it rather than folding.
                const intent = bulletClickIntent(e, false);
                if (intent !== "toggle") follow(nodeTarget(shownNodeId(row)), intent);
              }}
            />
          }
          content={
            <RowText node={row} instanceKey={instanceKey} isActive={isActive} tags={shown.tags} />
          }
        />
      </div>
      <div className="pt-1 pr-1">
        <RowChildren nodeId={row.id} instanceKey={instanceKey} depth={0} />
      </div>
    </div>
  );
}

/**
 * A group's header: its label and row count, as the one button that folds
 * and unfolds it, so Tab reaches it and Enter or Space toggles it.
 */
function GroupHeader({
  label,
  count,
  collapsed,
  onToggle,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const Caret = collapsed ? CaretRightIcon : CaretDownIcon;
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-1 px-2 py-1.5 text-left text-label font-medium text-foreground/35",
        "rounded-t-md outline-none hover:text-foreground/60 focus-visible:ring-2 focus-visible:ring-primary/60",
        !collapsed && "border-b border-foreground/[0.06]",
      )}
      aria-expanded={!collapsed}
      aria-label={`${label}, ${count} ${count === 1 ? "row" : "rows"}`}
      title={collapsed ? `Unfold ${label}` : `Fold ${label}`}
      data-group-header="true"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <Caret size={10} weight="bold" aria-hidden="true" />
      <span className="truncate">{label}</span>
      <span className="text-foreground/25" data-group-count="true">
        {count}
      </span>
    </button>
  );
}

const ViewCard = memo(function ViewCard({
  child,
  instanceKey,
  displayCols,
  context,
  RowText,
  Field,
  draggable,
  onDragStart,
  onDragEnd,
}: {
  child: OutlineNode;
  instanceKey: string;
  displayCols: Array<{ fieldId: string; label: string }>;
  /** What the card's field values resolve against (`fieldContextOf`). */
  context: FieldContext;
  RowText: FrameSubject["RowText"];
  Field: ComponentType<FieldEditorProps>;
  draggable: boolean;
  onDragStart?: (id: string) => void;
  onDragEnd?: () => void;
}) {
  const isActive = useIsActive(child.id, instanceKey);
  const isSelected = useIsSelected(child.id, instanceKey);
  const follow = useFollow();
  // The card's content is the shown node's (`lib/contextual-ref`); the card is `child`.
  const shown = shownNode(child, context.schema);

  return (
    <div
      className={cn(
        "view-card rounded-md border border-foreground/[0.06] bg-background p-2",
        draggable && "cursor-grab active:cursor-grabbing",
      )}
      data-view-card="true"
      data-node-id={child.id}
      data-instance-key={instanceKey}
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) return;
        e.dataTransfer.setData("text/plain", child.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart?.(child.id);
      }}
      onDragEnd={() => onDragEnd?.()}
    >
      <NodeRow
        depth={0}
        nodeId={child.id}
        instanceKey={instanceKey}
        isSelected={isSelected}
        isActive={isActive}
        onRowClick={() => browserHost().selectNode(child.id, instanceKey)}
        bullet={
          <Bullet
            node={shown}
            collapsed={child.collapsed}
            collapsible={false}
            isRef={isReferenceRow(child, isQueryResultInstance(instanceKey))}
            onClick={(e) => {
              e.stopPropagation();
              // A card's bullet cannot toggle: its children are not drawn.
              const intent = bulletClickIntent(e, false);
              if (intent !== "toggle") follow(nodeTarget(shownNodeId(child)), intent);
            }}
          />
        }
        content={<RowText node={child} instanceKey={instanceKey} isActive={isActive} tags={[]} />}
      />
      {shown.tags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-0.5 pl-1">
          <TagChipGroup
            tags={shown.tags}
            onTagClick={(tag, e) => {
              e.stopPropagation();
              follow(nodeTarget(tag.id), "open");
            }}
          />
        </div>
      )}
      {displayCols.length > 0 && (
        <div className="mt-1 flex flex-col gap-0.5">
          {displayCols.map((col) => (
            <Field
              key={col.fieldId}
              depth={-1}
              instanceKey={instanceKey}
              nodeId={shown.id}
              fieldId={col.fieldId}
              label={col.label}
              values={shown.props[col.fieldId] ?? []}
              context={context}
            />
          ))}
        </div>
      )}
    </div>
  );
});
