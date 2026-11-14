import { useCallback, useMemo } from "react";
import {
  cn,
  frameViewLabelOf,
  type FrameRowProps,
  FrameSubjectContext,
  indentStyle,
  type OutlineNode,
  schemaOf,
  shownNode,
  useFrameView,
  useFrameViewNode,
  useGraphRead,
  usePageGraph,
  ViewNotLoaded,
  ViewSlot,
  ViewUnavailable,
  resolveRowRows,
} from "@kb/ui-sdk";
import { projectsRows } from "@kb/views";
import { outlineFrameSubject } from "./outline-frame";
import { createTransientNode } from "./editing-writes";
import { outlineNodes, useOutlineStore } from "./outline.store";

/**
 * The children a row shows — its shown node's (`lib/contextual-ref`) — by
 * their frame's view, under the row's instance, and the strip that adds one
 * (`resolveRowRows`): the outline's own rows and any frame view that asks
 * (`FrameSubject.RowChildren`) draw them with this. A projected view is one
 * block, indented under the row; a list's rows indent themselves.
 */
export function RowChildren({ nodeId, instanceKey, depth }: FrameRowProps) {
  const { outline, schema } = useGraphRead();
  const node = outline.get(nodeId);
  const shown = node === undefined ? undefined : shownNode(node, schema);
  const view = useFrameView(shown);
  if (node === undefined || shown === undefined) return null;
  const key = view?.key ?? null;
  const rows = resolveRowRows({ node, schema, view: key, instanceKey });
  const slot = <FrameViewSlot frameId={shown.id} instanceKey={instanceKey} depth={depth} />;
  return (
    <>
      {rows.showsChildren &&
        (projectsRows(key) ? <div style={indentStyle(depth)}>{slot}</div> : slot)}
      {rows.showsCreateChild && <CreateChildStrip parentId={shown.id} depth={depth} />}
    </>
  );
}

/**
 * Tana whitespace-create: the strip under a row's children mints a transient
 * child, last, under `parentId` — the node the row shows — at the children's
 * `depth`.
 */
function CreateChildStrip({ parentId, depth }: { parentId: string; depth: number }) {
  const handleCreateChild = useCallback(() => {
    const parent = outlineNodes().get(parentId);
    const lastChild = parent?.children.at(-1) ?? null;
    void createTransientNode(parentId, lastChild);
  }, [parentId]);

  return (
    <div
      data-create-child-zone={parentId}
      role="button"
      tabIndex={0}
      aria-label="New child node"
      className={cn(
        "group/create relative flex h-6 cursor-pointer items-center rounded-sm",
        "outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
      )}
      style={indentStyle(depth)}
      onClick={handleCreateChild}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleCreateChild();
        }
      }}
      title="New child node"
    >
      <span
        className="flex h-6 w-6 items-center justify-center text-ui leading-none text-foreground/0 transition-colors duration-150 group-hover/create:text-foreground/25 group-focus-visible/create:text-foreground/25"
        aria-hidden
      >
        +
      </span>
    </div>
  );
}

/**
 * A frame whose view node names a view not provided here: the kit's "cannot be
 * shown here" state, inline, naming the view by its option node.
 */
function UnheldFrameView({ viewNode }: { readonly viewNode: OutlineNode | undefined }) {
  const label = frameViewLabelOf(viewNode, usePageGraph(schemaOf));
  return label === null ? (
    <ViewUnavailable why="Its view node names no view this graph holds." placement="inline" />
  ) : (
    <ViewNotLoaded label={label} placement="inline" />
  );
}

/**
 * A frame's children, shown by the view its config names, through a slot at
 * placement `inline`: the one way an outline host (the outline's root, a
 * projected frame's row, a query's results) renders a frame view. The view
 * lays the rows out; the outline edits each row's text and fields, and keeps
 * how many pages of them are revealed (`outlineFrameSubject`).
 */
export function FrameViewSlot({
  frameId,
  instanceKey,
  rowIds,
  isQuerySource = false,
  depth,
}: {
  readonly frameId: string;
  readonly instanceKey?: string | undefined;
  readonly rowIds?: readonly string[] | undefined;
  readonly isQuerySource?: boolean;
  readonly depth: number;
}) {
  const frame = useGraphRead().outline.get(frameId);
  const view = useFrameView(frame);
  const viewNode = useFrameViewNode(frame);
  // The pages revealed are the outline's, so the rows a view draws are the
  // rows its keyboard walk reaches.
  const pages = useOutlineStore((s) => s.framePages[frameId] ?? 1);
  const subject = useMemo(
    () =>
      outlineFrameSubject(
        { frameId, isQuerySource, depth, instanceKey, rowIds, RowChildren },
        pages,
      ),
    [frameId, instanceKey, rowIds, isQuerySource, depth, pages],
  );
  return (
    <FrameSubjectContext.Provider value={subject}>
      {view === null ? (
        <UnheldFrameView viewNode={viewNode} />
      ) : (
        <ViewSlot
          view={view.key}
          params={view.params}
          placement="inline"
          fallback={<ViewNotLoaded label={view.key.label} placement="inline" />}
          subject={frameId}
        />
      )}
    </FrameSubjectContext.Provider>
  );
}
