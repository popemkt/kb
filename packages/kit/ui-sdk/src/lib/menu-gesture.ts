/**
 * The gesture that asks an element for its menu: a right click (the
 * platform's context-menu event, which a keyboard's menu key and a held
 * finger on some phones raise too), or a finger held still on it for
 * `LONG_PRESS_MS`, which every phone can make. Either opens the menu once.
 *
 * A long press opens the menu while the finger is still down, so the rest
 * of that touch is the menu's: the context menu and the click the platform
 * raises as the finger lifts are swallowed wherever they land — on the
 * element, or on the menu that has opened over it — so a press never both
 * opens the menu and does what a tap does, nor closes what it opened.
 */
import { useEffect, useRef } from "react";
import { LONG_PRESS_MS, pastSlop, pointerKind } from "./pointer-slop";

/** The handlers an element spreads to hear the gesture. */
export interface MenuGesture {
  readonly onContextMenu: (e: React.MouseEvent) => void;
  readonly onPointerDown: (e: React.PointerEvent) => void;
  readonly onPointerMove: (e: React.PointerEvent) => void;
  readonly onPointerUp: () => void;
  readonly onPointerCancel: () => void;
}

/** How long after the finger lifts its click may still arrive, ms. */
const LIFT_CLICK_MS = 400;

/** An event that is the menu's, not the page's. */
function swallow(e: Event): void {
  e.preventDefault();
  e.stopPropagation();
}

/** Swallow the page's clicks and context menus until the returned function is called. */
function swallowTouchEnd(): () => void {
  window.addEventListener("click", swallow, true);
  window.addEventListener("contextmenu", swallow, true);
  return () => {
    window.removeEventListener("click", swallow, true);
    window.removeEventListener("contextmenu", swallow, true);
  };
}

/** The menu gesture's handlers, each calling `open` when it is made. */
export function useMenuGesture(open: () => void): MenuGesture {
  const press = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  // A long press opened the menu: what releases the rest of its touch.
  const release = useRef<(() => void) | null>(null);
  const stop = () => {
    if (press.current !== null) clearTimeout(press.current.timer);
    press.current = null;
  };
  const lift = () => {
    stop();
    const held = release.current;
    if (held === null) return;
    release.current = null;
    setTimeout(held, LIFT_CLICK_MS);
  };
  // Unmounted mid-press: no menu opens for a row that is gone, and nothing stays swallowed.
  useEffect(
    () => () => {
      if (press.current !== null) clearTimeout(press.current.timer);
      release.current?.();
    },
    [],
  );
  return {
    onContextMenu: (e) => {
      e.preventDefault();
      e.stopPropagation();
      stop();
      open();
    },
    onPointerDown: (e) => {
      if (pointerKind(e.pointerType) !== "touch") return;
      stop();
      press.current = {
        x: e.clientX,
        y: e.clientY,
        timer: setTimeout(() => {
          press.current = null;
          release.current = swallowTouchEnd();
          open();
        }, LONG_PRESS_MS),
      };
    },
    onPointerMove: (e) => {
      const at = press.current;
      if (at !== null && pastSlop(e.clientX - at.x, e.clientY - at.y, "touch")) stop();
    },
    onPointerUp: lift,
    onPointerCancel: lift,
  };
}
