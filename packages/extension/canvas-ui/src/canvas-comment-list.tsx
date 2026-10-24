/**
 * The comments list (DESIGN-UI.md → Canvas → Comments): every thread on
 * the canvas, open, resolved or all, in the dock (`CanvasDock`), and the
 * switch that puts it out. A thread pointed at marks what it is on; a
 * thread picked brings what it is on into view and opens it.
 */
import { ChatCircleIcon } from "@phosphor-icons/react";
import type { CanvasDoc, CanvasThread, CanvasWorld } from "@kb/canvas";
import { cn } from "@kb/ui-sdk";
import type { CanvasHitItem, CanvasView, ViewSize } from "./canvas-camera";
import { DockPanel, DockPick, IconRow, type IconChoice } from "./canvas-dock";
import { anchorFrame } from "./canvas-visible";
import { targetLabel } from "./comment-target";
import { shows, type CanvasComments, type ThreadFilter } from "./use-canvas-comments";

const FILTERS: readonly IconChoice<ThreadFilter>[] = [
  { value: "open", label: "Open", icon: <span className="text-label">Open</span> },
  { value: "resolved", label: "Resolved", icon: <span className="text-label">Resolved</span> },
  { value: "all", label: "All", icon: <span className="text-label">All</span> },
];

/** The dock's switch for the list: how many threads are open, lit while the list is out. */
export function CommentsToggle({ comments }: { readonly comments: CanvasComments }) {
  const open = comments.threads.filter((thread) => !thread.resolved).length;
  return (
    <DockPick
      aria-pressed={comments.listed}
      aria-label="Comments"
      title={comments.listed ? "Hide comments" : "Show comments"}
      data-testid="comments-toggle"
      className={cn(
        "relative flex h-8 w-8 items-center justify-center rounded-lg border shadow-floating backdrop-blur-sm",
        comments.listed
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-foreground/10 bg-popover/95 text-foreground/60 hover:text-foreground/85",
      )}
      onClick={() => comments.setListed(!comments.listed)}
    >
      <ChatCircleIcon size={16} />
      {open > 0 && (
        <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-label leading-none font-semibold text-primary-foreground tabular-nums">
          {open}
        </span>
      )}
    </DockPick>
  );
}

/** One thread in the list: what it says, what it is on, how many replies. */
function ThreadRow({
  thread,
  on,
  onPick,
  onPoint,
}: {
  readonly thread: CanvasThread;
  readonly on: string;
  readonly onPick: () => void;
  readonly onPoint: (pointed: boolean) => void;
}) {
  const replies = thread.replies.length;
  return (
    <DockPick
      data-comment-entry={thread.id}
      className={cn(
        "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-foreground/5",
        thread.resolved && "opacity-60",
      )}
      onPointerEnter={() => onPoint(true)}
      onPointerLeave={() => onPoint(false)}
      onClick={onPick}
    >
      <span className="line-clamp-2 text-ui text-foreground/85">{thread.text}</span>
      <span className="flex items-center gap-1 text-label text-foreground/45">
        <span className="min-w-0 flex-1 truncate">on {on}</span>
        {replies > 0 && (
          <span className="shrink-0">{replies === 1 ? "1 reply" : `${replies} replies`}</span>
        )}
      </span>
    </DockPick>
  );
}

export function CanvasCommentList({
  comments,
  doc,
  world,
  camera,
  frame,
}: {
  readonly comments: CanvasComments;
  readonly doc: CanvasDoc;
  readonly world: CanvasWorld;
  /** The showing camera: what a picked point thread is brought into view at. */
  readonly camera: () => { readonly view: CanvasView; readonly size: ViewSize };
  /** Bring `items` into view, as "zoom to selection" does. */
  readonly frame: (items: readonly CanvasHitItem[]) => void;
}) {
  if (!comments.listed) return null;
  const listed = comments.threads.filter((thread) => shows(comments.filter, thread));
  const reveal = (thread: CanvasThread) => {
    const { view, size } = camera();
    const items = anchorFrame(thread.anchor, doc, view, size);
    if (items.length > 0) frame(items);
    comments.show(thread.id);
  };
  return (
    <DockPanel
      name="comments"
      title="Comments"
      data-testid="comment-list"
      aside={<span className="text-label text-foreground/35 tabular-nums">{listed.length}</span>}
    >
      <div className="px-2 pt-0.5 pb-1">
        <IconRow
          label="Show"
          value={comments.filter}
          choices={FILTERS}
          onChange={comments.setFilter}
        />
      </div>
      <div className="flex flex-col gap-0.5 border-t border-foreground/[0.06] px-1 pt-1">
        {listed.length === 0 ? (
          <p className="px-2 py-2 text-label leading-snug text-foreground/40">
            {comments.filter === "resolved"
              ? "No resolved comments."
              : "No comments yet. Press M, then an item or a spot, to comment."}
          </p>
        ) : (
          listed.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              on={targetLabel(thread.anchor, doc, world)}
              onPick={() => reveal(thread)}
              onPoint={(pointed) => comments.point(pointed ? thread.id : null)}
            />
          ))
        )}
      </div>
    </DockPanel>
  );
}
