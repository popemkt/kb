/**
 * A frame's rows as a list beside one row's page (DESIGN-UI.md → List with
 * detail). The list's rows are the host's (`RowText`), and so is the page's
 * body: its fields through the page's field editor and its children through
 * `RowChildren`, so the page edits, nests and walks as the list does. Which
 * row it shows is the host's screen state (`FrameSubject.detail`), chosen
 * by the selection and read through `detailRowOf`, as the walk reads it.
 */
import { useEffect, useMemo } from "react";
import {
  browserHost,
  Bullet,
  bulletClickIntent,
  cn,
  type FieldContext,
  frameRows,
  type FrameSubject,
  isProjectedRow,
  isReferenceRow,
  NodeRow,
  nodeTarget,
  type OutlineNode,
  resolveProps,
  shownNode,
  shownNodeId,
  TagChipGroup,
  textOr,
  useFieldEditor,
  useFollow,
  useGraphRead,
  useIsActive,
  useIsSelected,
  usePageGraph,
} from "@kb/ui-sdk";
import { detailRowOf, type ParamsOf } from "@kb/views";
import { CollectionDetailView } from "@kb/collections";
import { AddRow } from "./add-row";

export function DetailView({
  frame,
  params,
}: {
  readonly frame: FrameSubject;
  readonly params: ParamsOf<typeof CollectionDetailView>;
}) {
  const { frameId, rowIds } = frame;
  const graph = useGraphRead();
  const generation = usePageGraph((s) => s.index?.generation ?? 0);
  const nodes = graph.outline;
  const view = useMemo(() => ({ key: CollectionDetailView, params }), [params]);
  const rows = useMemo(
    () => frameRows({ frameId, nodes, schema: graph.schema, view, rowIds }).rendered,
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- generation gates the store map's identity
    [frameId, nodes, graph.schema, view, rowIds, generation],
  );
  const keyFor = frame.rowKey;
  const shownId = detailRowOf(
    rows.map((row) => row.id),
    frame.detail,
  );
  const shown = rows.find((row) => row.id === shownId);

  if (nodes.get(frameId) === undefined && rowIds === undefined) return null;
  return (
    <div className="@container my-2" data-detail-view="true" data-frame-id={frameId}>
      <div className="grid items-start gap-3 @min-[480px]:grid-cols-[minmax(10rem,18rem)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col" data-detail-list="true">
          {rows.length === 0 && (
            <p className="px-2 py-1 text-ui text-foreground/45">No rows yet.</p>
          )}
          {rows.map((row) => (
            <DetailListRow
              key={keyFor(row.id)}
              row={row}
              instanceKey={keyFor(row.id)}
              frame={frame}
              isShown={row.id === shownId}
              context={graph}
            />
          ))}
          <AddRow frame={frame} filters={params.filters} label="Add a row" />
        </div>
        {shown !== undefined && (
          <DetailPage row={shown} instanceKey={keyFor(shown.id)} frame={frame} context={graph} />
        )}
      </div>
    </div>
  );
}

/** One row of the list: its bullet and text, the host's; selecting or editing it shows its page. */
function DetailListRow({
  row,
  instanceKey,
  frame,
  isShown,
  context,
}: {
  readonly row: OutlineNode;
  readonly instanceKey: string;
  readonly frame: FrameSubject;
  readonly isShown: boolean;
  readonly context: FieldContext;
}) {
  const isActive = useIsActive(row.id, instanceKey);
  const isSelected = useIsSelected(row.id, instanceKey);
  const follow = useFollow();
  const { RowText, showDetail } = frame;
  const shown = shownNode(row, context.schema);
  // The page follows the selection: the row chosen in the list is the one shown.
  useEffect(() => {
    if (isSelected || isActive) showDetail(row.id);
  }, [isSelected, isActive, showDetail, row.id]);
  return (
    <div
      className={cn("rounded-sm", isShown && "bg-foreground/[0.04]")}
      data-detail-row={row.id}
      data-shown={isShown ? "true" : undefined}
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
            collapsed={row.collapsed}
            collapsible={false}
            isRef={isReferenceRow(row, isProjectedRow(instanceKey))}
            onClick={(e) => {
              e.stopPropagation();
              // Its page is beside it, so the bullet follows, as a card's does.
              const intent = bulletClickIntent(e, false);
              if (intent !== "toggle") follow(nodeTarget(shownNodeId(row)), intent);
            }}
          />
        }
        content={<RowText node={row} instanceKey={instanceKey} isActive={isActive} tags={[]} />}
      />
    </div>
  );
}

/** The shown row's page: its text as the title, its tags and fields, and its children. */
function DetailPage({
  row,
  instanceKey,
  frame,
  context,
}: {
  readonly row: OutlineNode;
  readonly instanceKey: string;
  readonly frame: FrameSubject;
  readonly context: FieldContext;
}) {
  const Field = useFieldEditor();
  const follow = useFollow();
  const shown = shownNode(row, context.schema);
  const fields = resolveProps(shown, context.schema);
  const title = textOr(shown.text, "Untitled");
  const { RowChildren } = frame;
  return (
    <section
      className="min-w-0 rounded-md border border-foreground/[0.06] px-2 py-3"
      aria-label={title}
      data-detail-page={row.id}
    >
      <h3 className="mb-1 px-1 text-title font-medium break-words">{title}</h3>
      {shown.tags.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-0.5 px-1">
          <TagChipGroup
            tags={shown.tags}
            onTagClick={(tag, e) => {
              e.stopPropagation();
              follow(nodeTarget(tag.id), "open");
            }}
          />
        </div>
      )}
      {fields.length > 0 && (
        <div className="mb-2 flex flex-col gap-0.5">
          {fields.map((field) => (
            <Field
              key={field.fieldId}
              depth={-1}
              instanceKey={instanceKey}
              nodeId={shown.id}
              fieldId={field.fieldId}
              label={field.fieldName}
              values={field.values}
              context={context}
            />
          ))}
        </div>
      )}
      <RowChildren nodeId={row.id} instanceKey={instanceKey} depth={0} />
    </section>
  );
}
