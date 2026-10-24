/**
 * The comment threads on a canvas as the page shows them (DESIGN-UI.md →
 * Canvas → Comments): which thread's panel is open and what it is on, which
 * thread is pointed at, which threads are shown, whether the list is out,
 * and what a person writes from the panel. A comment is written through the
 * verb an agent and a script comment through (`ext.canvas.comment`), and
 * resolving or reopening a thread is writing its option field, as any field
 * is written.
 */
import { useState } from "react";
import { browserHost, logError } from "@kb/ui-sdk";
import {
  CANVAS_IDS,
  type CanvasThread,
  type CanvasWorld,
  type CommentAnchor,
  type CommentPlace,
} from "@kb/canvas";

/** The panel asked for: a thread's, or a new thread's at the place the comment tool was pressed. */
type CommentAsk = { readonly thread: string } | { readonly place: CommentPlace };

/** Which threads are shown, as pins and in the list: the open ones, the resolved ones, or all. */
export type ThreadFilter = "open" | "resolved" | "all";

/** Whether `filter` shows `thread`. */
export const shows = (filter: ThreadFilter, thread: CanvasThread): boolean =>
  filter === "all" || thread.resolved === (filter === "resolved");

/** What a new thread at `place` is on, as a thread's pin says it: the item pressed, or the point. */
function anchorOfPlace(place: CommentPlace): CommentAnchor | null {
  if ("on" in place) return { item: place.on };
  if ("at" in place) return { at: place.at };
  return null;
}

export interface CanvasComments {
  /** The threads on the canvas, each with its pin, its replies and whether it is resolved. */
  readonly threads: readonly CanvasThread[];
  /** The panel open: the thread it shows (null for a new one being written) and what it is on. */
  readonly open: {
    readonly thread: CanvasThread | null;
    readonly anchor: CommentAnchor | null;
  } | null;
  /** Open a new thread's panel at `place`, the comment tool's press. */
  readonly start: (place: CommentPlace) => void;
  /** Open `thread`'s panel. */
  readonly show: (thread: string) => void;
  readonly close: () => void;
  /** Write `text`: the new thread, or a reply to the thread open. */
  readonly post: (text: string) => Promise<Written>;
  /** Resolve the thread open, or reopen it. */
  readonly resolve: (resolved: boolean) => Promise<Written>;
  /** The thread pointed at, on its pin or in the list, whose target the canvas marks; null for none. */
  readonly pointed: string | null;
  readonly point: (thread: string | null) => void;
  readonly filter: ThreadFilter;
  readonly setFilter: (filter: ThreadFilter) => void;
  /** The comments list is out in the dock. */
  readonly listed: boolean;
  readonly setListed: (listed: boolean) => void;
}

/** How a write from the panel went: null once kb holds it, else why it did not. */
export type Written = string | null;

/** The id of the comment a verb's receipt says it wrote, if it says one. */
function writtenId(output: unknown): string | null {
  if (typeof output !== "object" || output === null || !("id" in output)) return null;
  return typeof output.id === "string" ? output.id : null;
}

export function useCanvasComments(canvasId: string, world: CanvasWorld): CanvasComments {
  const [ask, setAsk] = useState<CommentAsk | null>(null);
  const [pointed, point] = useState<string | null>(null);
  const [filter, setFilter] = useState<ThreadFilter>("open");
  const [listed, setListed] = useState(false);
  const threads = world.threadsOn(canvasId);
  const open = (() => {
    if (ask === null) return null;
    if ("place" in ask) return { thread: null, anchor: anchorOfPlace(ask.place) };
    // A thread just written opens once kb holds it.
    const thread = threads.find((one) => one.id === ask.thread);
    return thread === undefined ? null : { thread, anchor: thread.anchor };
  })();

  const post = async (text: string): Promise<Written> => {
    if (ask === null) return "No thread is open.";
    const where = "thread" in ask ? { replyTo: ask.thread } : ask.place;
    const receipt = await browserHost().invoke("ext.canvas.comment", { canvasId, text, ...where });
    if (receipt.status === "failed") {
      logError("[kb/canvas] comment failed:", receipt.message);
      return receipt.message;
    }
    // A new thread opens as itself; one whose receipt names no comment is written but cannot be.
    if ("place" in ask) {
      const id = writtenId(receipt.output);
      setAsk(id === null ? null : { thread: id });
    }
    return null;
  };

  const resolve = async (resolved: boolean): Promise<Written> => {
    if (ask === null || !("thread" in ask)) return "No thread is open.";
    const field = CANVAS_IDS.commentStateField;
    const state = resolved ? CANVAS_IDS.commentResolved : CANVAS_IDS.commentOpen;
    const receipt = await browserHost().invoke("node.update", {
      id: ask.thread,
      unsetProps: [{ field }],
      setProps: [{ field, value: { t: "ref", v: state } }],
    });
    if (receipt.status === "failed") {
      logError("[kb/canvas] resolving failed:", receipt.message);
      return receipt.message;
    }
    return null;
  };

  return {
    threads,
    open,
    start: (place) => setAsk({ place }),
    show: (thread) => setAsk({ thread }),
    close: () => setAsk(null),
    post,
    resolve,
    pointed,
    point,
    filter,
    setFilter,
    listed,
    setListed,
  };
}
