import type { ReactNode } from "react";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { Bullet, NodeRow, navigate, type OutlineNode } from "@kb/ui-sdk";
import { CANVAS_LIST_PATH } from "./routes";

/**
 * The canvas page's header: the way back to every canvas, its node, and its
 * zoom; under it, the board's pages. On a compact stage the way back is a
 * mark, the pages stand in the row in the node's place (the page showing
 * names it), and Add node is left to the kb node tool behind More, which
 * places one as this does (`pickTool`).
 */
export function CanvasHeader({
  compact,
  canvasNode,
  pages,
  onAddNode,
  zoom,
}: {
  readonly compact: boolean;
  readonly canvasNode: OutlineNode;
  /** The page strip (`CanvasPageStrip`). */
  readonly pages: ReactNode;
  readonly onAddNode: () => void;
  readonly zoom: ReactNode;
}) {
  return (
    <>
      <div className="kb-chrome flex h-10 shrink-0 items-center gap-2 border-b border-foreground/[0.06] px-3">
        <button
          type="button"
          title="All canvases"
          className="shrink-0 text-meta text-muted-foreground hover:text-foreground"
          onClick={() => navigate(CANVAS_LIST_PATH)}
        >
          {compact ? <ArrowLeftIcon size={16} aria-label="All canvases" /> : "← canvases"}
        </button>
        {compact ? (
          pages
        ) : (
          <>
            <NodeRow
              depth={0}
              nodeId={canvasNode.id}
              bullet={<Bullet node={canvasNode} onClick={() => {}} />}
              content={
                <span className="kb-display truncate text-ui text-foreground/70">
                  {canvasNode.text}
                </span>
              }
              className="min-w-0 flex-1"
            />
            <button
              type="button"
              className="rounded-md border border-border px-2 py-1 text-meta text-muted-foreground hover:bg-foreground/5"
              onClick={onAddNode}
            >
              Add node
            </button>
          </>
        )}
        {zoom}
      </div>
      {!compact && pages}
    </>
  );
}
