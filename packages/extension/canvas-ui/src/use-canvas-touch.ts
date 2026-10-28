/**
 * The canvas's touch gestures (`canvas-touch.ts`) on the page: every press
 * on the stage is heard first here, before either projection or React hears
 * it — on the window, in the capture phase, since React hears from its root,
 * below the window — so a finger the gesture owns reaches no projection.
 * What pressed is kept too: the reducer reads its slop by it (`pastSlop`).
 *
 * A touch is the gesture's only over a projection (`data-canvas-surface`):
 * the chrome over the stage (the tool strip, the dock, a menu) takes its
 * taps as any button does, and words being typed keep the browser's own
 * touch.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { asElement, isTyping, pointerKind, type PointerKind } from "@kb/ui-sdk";
import type { CanvasViewportControls } from "./canvas-camera";
import { TouchGestures, type TouchHost } from "./canvas-touch";

/** Before the stage has mounted there is nothing to move. */
const IDLE: TouchHost = {
  cancel: () => {},
  panBy: () => {},
  zoomAt: () => {},
  settle: () => {},
  menu: () => {},
  after: () => () => {},
};

/** Where a finger went down and is now, in the window: where its press is cancelled. */
interface Finger {
  readonly target: EventTarget;
  clientX: number;
  clientY: number;
}

/** Whether `target` is a projection's own surface: not chrome over it, not words being typed. */
const onSurface = (target: EventTarget | null): boolean =>
  !isTyping(target) && (asElement(target)?.closest("[data-canvas-surface]") ?? null) !== null;

/**
 * What the gesture asks of the page: a finger's press cancelled, the
 * showing camera (`camera`, as last committed) moved, the context menu
 * opened, a timer.
 */
function touchHost(
  stage: RefObject<HTMLElement | null>,
  fingers: ReadonlyMap<number, Finger>,
  camera: { readonly current: CanvasViewportControls },
): TouchHost {
  return {
    // The browser's own word for a touch it takes: both projections already undo what it began.
    cancel: (id) => {
      const finger = fingers.get(id);
      if (finger === undefined) return;
      const { clientX, clientY } = finger;
      finger.target.dispatchEvent(
        new PointerEvent("pointercancel", {
          bubbles: true,
          pointerId: id,
          pointerType: "touch",
          clientX,
          clientY,
        }),
      );
    },
    panBy: (dx, dy) => camera.current.panBy(dx, dy),
    zoomAt: (factor, at) => camera.current.zoomAt(factor, at),
    settle: () => camera.current.settle(),
    // A right click where the finger is: the context menu opens as it does for one.
    menu: (at) => {
      const rect = stage.current?.getBoundingClientRect();
      const clientX = (rect?.left ?? 0) + at.x;
      const clientY = (rect?.top ?? 0) + at.y;
      document.elementFromPoint(clientX, clientY)?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX,
          clientY,
        }),
      );
    },
    after: (ms, act) => {
      const timer = setTimeout(act, ms);
      return () => clearTimeout(timer);
    },
  };
}

export function useCanvasTouch({
  stage,
  controls,
  pressedBy,
}: {
  readonly stage: RefObject<HTMLElement | null>;
  /** The showing camera's controls, as the page last committed them. */
  readonly controls: CanvasViewportControls;
  /** What made the last press on the stage, written here. */
  readonly pressedBy: { current: PointerKind };
}): void {
  const [touch] = useState(() => new TouchGestures(IDLE));
  const camera = useRef(controls);
  useLayoutEffect(() => {
    camera.current = controls;
  });
  useEffect(() => {
    const fingers = new Map<number, Finger>();
    /** The stage, if `target` is on it. */
    const stageOf = (target: EventTarget | null): HTMLElement | null => {
      const el = stage.current;
      return el !== null && target instanceof Node && el.contains(target) ? el : null;
    };
    const local = (clientX: number, clientY: number) => {
      const rect = stage.current?.getBoundingClientRect();
      return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
    };
    touch.bind(touchHost(stage, fingers, camera));
    /** A gesture of the fingers' has ended: the click a lifted finger may still send is its too. */
    let lifted = false;
    const own = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const down = (event: PointerEvent) => {
      const el = stageOf(event.target);
      if (el === null) return;
      lifted = false;
      pressedBy.current = pointerKind(event.pointerType);
      if (event.pointerType !== "touch" || !onSurface(event.target)) return;
      const { clientX, clientY } = event;
      fingers.set(event.pointerId, { target: event.target ?? el, clientX, clientY });
      if (touch.down(event.pointerId, local(clientX, clientY))) own(event);
    };
    const move = (event: PointerEvent) => {
      const finger = fingers.get(event.pointerId);
      if (finger === undefined) return;
      finger.clientX = event.clientX;
      finger.clientY = event.clientY;
      if (touch.move(event.pointerId, local(event.clientX, event.clientY))) own(event);
    };
    const up = (event: PointerEvent) => {
      // The cancel the gesture sends itself goes on to the projection.
      if (!event.isTrusted || !fingers.delete(event.pointerId)) return;
      if (!touch.up(event.pointerId)) return;
      own(event);
      lifted = true;
    };
    // The browser's own long-press menu: a finger's long press is the gesture's.
    const menu = (event: MouseEvent) => {
      if (event.isTrusted && touch.active && stageOf(event.target) !== null) own(event);
    };
    const click = (event: MouseEvent) => {
      if (!lifted || stageOf(event.target) === null) return;
      lifted = false;
      own(event);
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    window.addEventListener("contextmenu", menu, true);
    window.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      window.removeEventListener("contextmenu", menu, true);
      window.removeEventListener("click", click, true);
      touch.bind(IDLE);
    };
  }, [stage, touch, pressedBy]);
}
