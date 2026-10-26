/**
 * A comment thread's panel (DESIGN-UI.md → Canvas → Comments): what the
 * thread is on, its comments in order, a reply, and Resolve or Reopen. It
 * stands beside what it is on (`placeBeside`), never over it, and goes with
 * it as the camera moves; it is dismissed as every popover is
 * (`useDismiss`).
 */
import { useLayoutEffect, useRef, useState } from "react";
import { CrosshairSimpleIcon, XIcon } from "@phosphor-icons/react";
import type { CanvasThread } from "@kb/canvas";
import { cn, useDismiss } from "@kb/ui-sdk";
import type { CanvasPoint, ScreenRect, ViewSize } from "./canvas-camera";
import { DOCK_RESERVE } from "./canvas-dock-size";
import { placeBeside } from "./canvas-visible";
import type { Written } from "./use-canvas-comments";

const ACTION = cn(
  "rounded-md px-2 py-1 text-meta text-foreground/60 hover:bg-foreground/5 hover:text-foreground/85",
  "disabled:opacity-40 disabled:hover:bg-transparent",
);

/** How wide the panel stands, CSS pixels. */
const WIDTH = 256;

export interface CommentThreadPanelProps {
  /** The thread shown; null for a new one being written. */
  readonly thread: CanvasThread | null;
  /** What it is on, in words (`targetLabel`). */
  readonly on: string;
  /** Where what it is on is drawn on the stage (`anchorRects`). */
  readonly target: readonly ScreenRect[];
  readonly stage: ViewSize;
  readonly onClose: () => void;
  /** Write a comment; the draft is kept until kb holds it. */
  readonly onPost: (text: string) => Promise<Written>;
  readonly onResolve: (resolved: boolean) => Promise<Written>;
}

export function CommentThreadPanel({
  thread,
  on,
  target,
  stage,
  onClose,
  onPost,
  onResolve,
}: CommentThreadPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  /** How tall the panel stands, read as it is drawn: where it fits beside its target turns on it. */
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    setHeight(el.offsetHeight);
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // A thread opens from a gesture on the canvas or the list: nothing toggles it.
  useDismiss(true, { inside: [ref], trigger: null }, onClose);
  const at: CanvasPoint = placeBeside(target, { width: WIDTH, height }, stage, DOCK_RESERVE);
  const title = thread === null ? "New comment" : thread.resolved ? "Resolved" : "Comment";
  // GAP [[01M54GBYH3K67TAW016HFCJHBC]] a comment shows what it says, not who said it: the store keeps no writer for a node
  const said = thread === null ? [] : [thread, ...thread.replies];
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={title}
      data-testid="comment-panel"
      className="pointer-events-auto absolute z-40 flex max-h-[min(28rem,calc(100%-24px))] flex-col rounded-lg border border-border bg-popover shadow-overlay"
      style={{ left: at.x, top: at.y, width: WIDTH }}
    >
      <header className="flex shrink-0 items-start gap-1 px-2.5 pt-2 pb-1.5">
        <div className="min-w-0 flex-1">
          <h2 className="text-label tracking-wide text-foreground/40 uppercase">{title}</h2>
          <p
            className="flex items-center gap-1 truncate text-label text-primary/80"
            title={`On ${on}`}
            data-comment-on
          >
            <CrosshairSimpleIcon size={11} className="shrink-0" />
            <span className="truncate">On {on}</span>
          </p>
        </div>
        <button
          type="button"
          aria-label="Close"
          title="Close (Esc)"
          className="rounded-sm p-0.5 text-foreground/40 hover:bg-foreground/5 hover:text-foreground/75"
          onClick={onClose}
        >
          <XIcon size={12} />
        </button>
      </header>
      {said.length > 0 && (
        <ol className="min-h-0 overflow-y-auto overscroll-contain border-t border-foreground/[0.06]">
          {said.map((comment) => (
            <li
              key={comment.id}
              data-comment={comment.id}
              className="whitespace-pre-wrap border-b border-foreground/[0.04] px-2.5 py-1.5 text-ui text-foreground/80 last:border-b-0"
            >
              {comment.text}
            </li>
          ))}
        </ol>
      )}
      <CommentForm thread={thread} onPost={onPost} onResolve={onResolve} />
    </div>
  );
}

/**
 * What is written from the panel: a comment or a reply, and Resolve or
 * Reopen. The words stay until kb holds them; a write kb does not take says
 * why, and nothing more is sent while one is on its way.
 */
function CommentForm({
  thread,
  onPost,
  onResolve,
}: Pick<CommentThreadPanelProps, "thread" | "onPost" | "onResolve">) {
  const [draft, setDraft] = useState("");
  /** A write is on its way: nothing more is sent until it lands. */
  const [sending, setSending] = useState(false);
  /** Why the last write did not land, shown until the next one. */
  const [failed, setFailed] = useState<string | null>(null);
  const write = async (written: () => Promise<Written>): Promise<boolean> => {
    setSending(true);
    setFailed(null);
    const why = await written();
    setSending(false);
    setFailed(why);
    return why === null;
  };
  const send = async () => {
    const text = draft.trim();
    if (text === "" || sending) return;
    if (await write(() => onPost(text))) setDraft("");
  };
  return (
    <div className="shrink-0 border-t border-foreground/[0.06] px-2 pt-1.5 pb-1">
      <textarea
        autoFocus
        aria-label={thread === null ? "Comment" : "Reply"}
        placeholder={thread === null ? "Comment…" : "Reply…"}
        rows={2}
        value={draft}
        className="w-full resize-none rounded-md border border-border bg-background px-2 py-1 text-ui outline-none focus:border-primary/50"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
          e.preventDefault();
          void send();
        }}
      />
      {failed !== null && (
        <p role="alert" className="px-0.5 pt-1 text-label text-destructive">
          {failed}
        </p>
      )}
      <div className="flex items-center justify-between pt-0.5">
        {thread === null ? (
          <span />
        ) : (
          <button
            type="button"
            className={ACTION}
            disabled={sending}
            onClick={() => void write(() => onResolve(!thread.resolved))}
          >
            {thread.resolved ? "Reopen" : "Resolve"}
          </button>
        )}
        <button
          type="button"
          className={ACTION}
          disabled={sending || draft.trim() === ""}
          onClick={() => void send()}
        >
          {thread === null ? "Comment" : "Reply"}
        </button>
      </div>
    </div>
  );
}
