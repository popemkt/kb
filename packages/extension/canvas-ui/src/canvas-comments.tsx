/**
 * Comment threads over the canvas (DESIGN-UI.md → Canvas → Comments): a
 * pin for each thread shown where the shown projection draws what it is on
 * (`threadPins`, the camera model's), with how many comments it holds; the
 * mark round what a thread is on while it is pointed at or open, and round
 * what the comment tool would comment on; and the open thread's panel,
 * beside what it is on.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ChatCircleIcon } from "@phosphor-icons/react";
import { paintOrder, type CanvasDoc, type CanvasWorld, type CommentAnchor } from "@kb/canvas";
import { cn } from "@kb/ui-sdk";
import {
  hitTest,
  type CanvasPoint,
  type CanvasView,
  type ScreenRect,
  type ViewSize,
} from "./canvas-camera";
import type { CanvasCameraRig } from "./canvas-camera-rig";
import { CommentThreadPanel } from "./canvas-comment-thread";
import type { CanvasTool } from "./canvas-tool";
import { anchorRects, threadPins } from "./canvas-visible";
import { targetLabel } from "./comment-target";
import { shows, type CanvasComments } from "./use-canvas-comments";
import { useShownView } from "./use-shown-view";

/** How far a pin reaches up and right of the corner it stands on, scaled while hinted. */
const PIN_REACH = 30;

/** A box with the pin at its top right: what a thread's panel keeps clear of. */
const withPin = (r: ScreenRect): ScreenRect => ({
  ...r,
  top: r.top - PIN_REACH,
  right: r.right + PIN_REACH,
});

/** The mark round what a thread is on: the selection's outline, in its primary. */
const MARK =
  "pointer-events-none absolute rounded-sm border-2 border-primary/70 ring-4 ring-primary/15";

/** The mark round each of `rects`; a point's is a dot. */
function TargetMarks({ rects }: { readonly rects: readonly ScreenRect[] }) {
  return rects.map((r) =>
    r.right === r.left ? (
      <span
        key={`${r.left},${r.top}`}
        data-comment-target
        className={cn(MARK, "h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full")}
        style={{ left: r.left, top: r.top }}
      />
    ) : (
      <span
        key={`${r.left},${r.top},${r.right},${r.bottom}`}
        data-comment-target
        className={MARK}
        style={{
          left: r.left - 4,
          top: r.top - 4,
          width: r.right - r.left + 8,
          height: r.bottom - r.top + 8,
        }}
      />
    ),
  );
}

/**
 * The item the pointer is over on `stage`, as a press there would hit it
 * (`hitTest` over `paintOrder`, the press's own path), in either
 * projection: what a pin is hinted for, and what the comment tool would
 * comment on. Looked for at most once a frame, and only while `seen()`
 * gives a camera, so a stage nothing is hinted on pays nothing.
 */
function usePointedItem(
  stage: RefObject<HTMLElement | null>,
  seen: () => {
    readonly doc: CanvasDoc;
    readonly view: CanvasView;
    readonly size: ViewSize;
  } | null,
): string | null {
  const [item, setItem] = useState<string | null>(null);
  const read = useRef(seen);
  useLayoutEffect(() => {
    read.current = seen;
  });
  useEffect(() => {
    const el = stage.current;
    if (el === null) return undefined;
    let frame: number | null = null;
    let client: CanvasPoint | null = null;
    const look = () => {
      frame = null;
      const camera = read.current();
      if (client === null || camera === null) {
        setItem(null);
        return;
      }
      const box = el.getBoundingClientRect();
      const at = { x: client.x - box.left, y: client.y - box.top };
      setItem(hitTest(paintOrder(camera.doc.nodes), camera.view, camera.size, at));
    };
    const move = (e: PointerEvent) => {
      client = { x: e.clientX, y: e.clientY };
      frame ??= requestAnimationFrame(look);
    };
    const leave = () => {
      client = null;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      setItem(null);
    };
    el.addEventListener("pointermove", move, { passive: true });
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [stage]);
  return item;
}

/**
 * Each shown thread's pin, drawn over the stage where the shown camera puts
 * what it is pinned on and cut off at the stage's edge as the items are;
 * the marks; and the open thread's panel.
 */
export function CanvasCommentLayer({
  rig,
  in3d,
  flatView,
  width,
  height,
  doc,
  world,
  tool,
  stage,
  comments,
}: {
  readonly rig: CanvasCameraRig;
  /** The 3D scene is the one showing (otherwise the view is `flatView`). */
  readonly in3d: boolean;
  readonly flatView: CanvasView;
  readonly width: number;
  readonly height: number;
  readonly doc: CanvasDoc;
  readonly world: CanvasWorld;
  /** The armed tool: the comment tool marks what a press would comment on. */
  readonly tool: CanvasTool;
  /** The stage the pointer moves over. */
  readonly stage: RefObject<HTMLElement | null>;
  readonly comments: CanvasComments;
}) {
  const view = useShownView(rig, in3d, flatView);
  const size = { width, height };
  const shown = comments.threads.filter((thread) => shows(comments.filter, thread));
  const commenting = tool === "comment";
  const pins = threadPins(shown, doc, view, size);
  const under = usePointedItem(stage, () =>
    commenting || pins.length > 0 ? { doc, view, size } : null,
  );
  // Out of the comment tool, only an item a pin stands on is hinted.
  const pointedItem = commenting || pins.some(({ item }) => item === under) ? under : null;
  const rectsOf = (anchor: CommentAnchor | null) =>
    anchorRects(anchor, doc, view, size).map(({ rect }) => rect);
  const pointed = comments.threads.find((thread) => thread.id === comments.pointed);
  const { open } = comments;
  const marked = [
    ...(open === null ? [] : rectsOf(open.anchor)),
    ...(pointed === undefined || pointed.id === open?.thread?.id ? [] : rectsOf(pointed.anchor)),
    ...(commenting && pointedItem !== null ? rectsOf({ item: pointedItem }) : []),
  ];
  const aimed = commenting && pointedItem !== null ? rectsOf({ item: pointedItem })[0] : undefined;
  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      <TargetMarks rects={marked} />
      {aimed !== undefined && (
        <span
          data-comment-aim
          className="absolute -translate-y-full rounded-md bg-primary px-1.5 py-0.5 text-label whitespace-nowrap text-primary-foreground shadow-floating"
          style={{ left: aimed.left - 4, top: aimed.top - 8 }}
        >
          Comment on {targetLabel({ item: pointedItem ?? "" }, doc, world)}
        </span>
      )}
      {pins.map(({ thread, item, at }) => {
        const count = 1 + thread.replies.length;
        const hinted =
          comments.pointed === thread.id || open?.thread?.id === thread.id || item === pointedItem;
        return (
          <button
            key={`${thread.id}:${item ?? "at"}`}
            type="button"
            data-comment-pin={thread.id}
            aria-label={`Comment: ${thread.text}`}
            title={thread.text}
            className={cn(
              "pointer-events-auto absolute flex h-6 min-w-6 -translate-y-full items-center justify-center gap-0.5 px-1",
              "rounded-full rounded-bl-none border border-primary/40 bg-primary text-label font-semibold text-primary-foreground tabular-nums shadow-floating",
              "transition-[transform,opacity] duration-100 origin-bottom-left",
              thread.resolved && "opacity-45 saturate-50",
              hinted && "scale-125 opacity-100",
            )}
            style={{ left: at.x, top: at.y }}
            onPointerEnter={() => comments.point(thread.id)}
            onPointerLeave={() => comments.point(null)}
            onFocus={() => comments.point(thread.id)}
            onBlur={() => comments.point(null)}
            onClick={() => comments.show(thread.id)}
          >
            {count > 1 ? count : <ChatCircleIcon size={13} weight="fill" />}
          </button>
        );
      })}
      {open !== null && (
        <CommentThreadPanel
          key={open.thread?.id ?? "new"}
          thread={open.thread}
          on={targetLabel(open.anchor, doc, world)}
          target={rectsOf(open.anchor).map(withPin)}
          stage={size}
          onClose={comments.close}
          onPost={comments.post}
          onResolve={comments.resolve}
        />
      )}
    </div>
  );
}
