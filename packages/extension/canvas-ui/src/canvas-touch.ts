/**
 * Fingers over the canvas, as the gestures every phone canvas makes
 * (tldraw's, Excalidraw's, Figma's; DESIGN-UI.md → Canvas → Touch): heard
 * before either projection hears them, so both take touch alike. Plain
 * state, no DOM: the host feeds it touches in viewport coordinates and it
 * answers through `TouchHost`.
 *
 * - One finger is a press, as a mouse's is: it goes on to the projection,
 *   which does with it what the armed tool does.
 * - A second finger makes it a camera gesture. The first finger's press is
 *   cancelled the way the browser cancels a touch it takes for itself, so
 *   whatever it had begun (a carry, a marquee, a stroke) goes; then until
 *   the last finger lifts, the fingers' midpoint pans the view and their
 *   spread zooms it about that midpoint. One finger left pans.
 * - A finger held still for `LONG_PRESS_MS` is a long press: its press is
 *   cancelled and the context menu opens where it is, as a right click's
 *   does. The finger is then the menu's until it lifts.
 *
 * Whether a finger has moved is read by the touch slop (`POINTER_SLOPS`), and
 * how long it waits by `LONG_PRESS_MS`.
 */
import { LONG_PRESS_MS, pastSlop } from "@kb/ui-sdk";
import type { CanvasPoint } from "./canvas-camera";

export interface TouchHost {
  /** Cancel the press finger `id` began in the projection, as the browser does a touch it takes. */
  readonly cancel: (id: number) => void;
  /** Move the view so the canvas follows the fingers (dx, dy). */
  readonly panBy: (dx: number, dy: number) => void;
  /** Zoom by `factor` about `at`, a viewport point. */
  readonly zoomAt: (factor: number, at: CanvasPoint) => void;
  /** The fingers that moved the view have all lifted. */
  readonly settle: () => void;
  /** Open the context menu at `at`, a viewport point, as a right click there would. */
  readonly menu: (at: CanvasPoint) => void;
  /** Run `act` after `ms`; the answer calls it off. */
  readonly after: (ms: number, act: () => void) => () => void;
}

type Gesture =
  /** One finger pressing, which the projection has: a long press is waited for until it moves. */
  | {
      readonly kind: "press";
      readonly id: number;
      readonly from: CanvasPoint;
      at: CanvasPoint;
      waiting: (() => void) | null;
    }
  /** Fingers moving the camera, by id: every one down is the gesture's until the last lifts. */
  | { readonly kind: "camera"; readonly fingers: Map<number, CanvasPoint>; moved: boolean }
  /** A long press opened the menu: its fingers are the menu's until they lift. */
  | { readonly kind: "menu"; readonly fingers: Set<number> };

const midpoint = (points: readonly CanvasPoint[]): CanvasPoint => ({
  x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
  y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
});

/** How far apart the first two fingers are; null with fewer. */
const spreadOf = (points: readonly CanvasPoint[]): number | null => {
  const [a, b] = points;
  return a === undefined || b === undefined ? null : Math.hypot(a.x - b.x, a.y - b.y);
};

export class TouchGestures {
  private gesture: Gesture | null = null;
  private host: TouchHost;

  constructor(host: TouchHost) {
    this.host = host;
  }

  /** Answer through `host` from now on (the page, as it last committed). */
  bind(host: TouchHost): void {
    this.host = host;
  }

  /** A finger is on the glass: the browser's own long-press menu is not wanted. */
  get active(): boolean {
    return this.gesture !== null;
  }

  /** Finger `id` went down at `at`; whether it is the gesture's, so the projection must not hear it. */
  down(id: number, at: CanvasPoint): boolean {
    const g = this.gesture;
    if (g === null) {
      const press: Gesture = { kind: "press", id, from: at, at, waiting: null };
      press.waiting = this.host.after(LONG_PRESS_MS, () => this.longPress(press));
      this.gesture = press;
      return false;
    }
    if (g.kind === "press") {
      g.waiting?.();
      this.host.cancel(g.id);
      this.gesture = {
        kind: "camera",
        fingers: new Map([
          [g.id, g.at],
          [id, at],
        ]),
        moved: false,
      };
      return true;
    }
    if (g.kind === "camera") g.fingers.set(id, at);
    else g.fingers.add(id);
    return true;
  }

  /** Finger `id` moved to `at`; whether it is the gesture's. */
  move(id: number, at: CanvasPoint): boolean {
    const g = this.gesture;
    if (g === null) return false;
    if (g.kind === "press") {
      if (g.id !== id) return false;
      g.at = at;
      if (g.waiting !== null && pastSlop(at.x - g.from.x, at.y - g.from.y, "touch")) {
        g.waiting();
        g.waiting = null;
      }
      return false;
    }
    if (g.kind === "menu") return g.fingers.has(id);
    const was = g.fingers.get(id);
    if (was === undefined) return false;
    const before = [...g.fingers.values()];
    g.fingers.set(id, at);
    const after = [...g.fingers.values()];
    const from = midpoint(before);
    const to = midpoint(after);
    this.host.panBy(to.x - from.x, to.y - from.y);
    const spread = spreadOf(before);
    const next = spreadOf(after);
    if (spread !== null && next !== null && spread > 0 && next > 0) {
      this.host.zoomAt(next / spread, to);
    }
    g.moved = true;
    return true;
  }

  /** Finger `id` lifted, or the browser took it; whether it was the gesture's. */
  up(id: number): boolean {
    const g = this.gesture;
    if (g === null) return false;
    if (g.kind === "press") {
      if (g.id !== id) return false;
      g.waiting?.();
      this.gesture = null;
      return false;
    }
    if (!g.fingers.delete(id)) return false;
    if (g.fingers.size === 0) {
      this.gesture = null;
      if (g.kind === "camera" && g.moved) this.host.settle();
    }
    return true;
  }

  /** `press` was held still for the long-press time: it opens the menu, if it is still the press. */
  private longPress(press: Extract<Gesture, { kind: "press" }>): void {
    if (this.gesture !== press) return;
    this.host.cancel(press.id);
    this.gesture = { kind: "menu", fingers: new Set([press.id]) };
    this.host.menu(press.at);
  }
}
