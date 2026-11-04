/**
 * The calendar's pointer gestures, one controller for every layout: press an
 * instance and drag it to move it, drag its lower edge to resize it, press
 * an empty slot (and drag) to make one there. A press that does not travel is
 * a click. Where the pointer is reads off the day cell under it
 * (`data-calendar-day`), and in the week's time grid (`data-calendar-timed`)
 * the minute off its height, so every layout moves things the same way.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { CalendarEntry } from "@kb/routines";
import { minutesAt, SNAP_MINUTES } from "./layout";

/** Where the pointer is over the calendar: a day, and the minute when over the time grid. */
export interface Spot {
  readonly day: string;
  readonly minutes: number | null;
}

export type Drag =
  | {
      readonly kind: "move";
      readonly entry: CalendarEntry;
      /** Minutes between the instance's start and where it was grabbed. */
      readonly grab: number;
      readonly to: Spot;
    }
  | {
      readonly kind: "resize";
      readonly entry: CalendarEntry;
      /** The displayed day its column shows. */
      readonly day: string;
      readonly top: number;
      readonly bottom: number;
    }
  | { readonly kind: "create"; readonly day: string; readonly from: number; readonly to: number };

export interface DragHandlers {
  /** A press on an instance that did not travel. */
  readonly click: (entry: CalendarEntry, element: HTMLElement) => void;
  readonly move: (entry: CalendarEntry, to: Spot) => void;
  /** An instance's lower edge let go: the displayed day and minute it now ends at. */
  readonly resize: (
    entry: CalendarEntry,
    end: { readonly day: string; readonly minutes: number },
  ) => void;
  /** An empty slot pressed: a day, with the minutes chosen when on the time grid. */
  readonly create: (
    day: string,
    minutes: { readonly from: number; readonly to: number } | null,
  ) => void;
}

/** How far a press travels, in pixels, before it is a drag. */
const SLOP = 4;

/** The day cell and minute under the pointer, if it is over the calendar. */
function spotAt(event: Pick<PointerEvent, "clientX" | "clientY" | "target">): Spot | null {
  const under =
    typeof document.elementFromPoint === "function"
      ? document.elementFromPoint(event.clientX, event.clientY)
      : null;
  const target = event.target instanceof HTMLElement ? event.target : null;
  const cell =
    under?.closest<HTMLElement>("[data-calendar-day]") ??
    target?.closest<HTMLElement>("[data-calendar-day]") ??
    null;
  const day = cell?.dataset["calendarDay"];
  if (cell === null || day === undefined) return null;
  if (cell.dataset["calendarTimed"] === undefined) return { day, minutes: null };
  return { day, minutes: minutesAt(event.clientY - cell.getBoundingClientRect().top) };
}

interface Press {
  /** The one pointer the gesture follows; another finger or pen is not it. */
  readonly pointer: number;
  readonly x: number;
  readonly y: number;
  readonly element: HTMLElement;
  travelled: boolean;
  drag: Drag;
}

function moved(drag: Drag, spot: Spot | null): Drag {
  if (spot === null) return drag;
  if (drag.kind === "move") {
    // An all-day instance keeps lasting all day; a timed one keeps its time on a day cell.
    if (drag.entry.start === null) return { ...drag, to: { day: spot.day, minutes: null } };
    const minutes = spot.minutes === null ? drag.to.minutes : Math.max(0, spot.minutes - drag.grab);
    return { ...drag, to: { day: spot.day, minutes } };
  }
  if (spot.minutes === null) return drag;
  if (drag.kind === "resize")
    return { ...drag, bottom: Math.max(drag.top + SNAP_MINUTES, spot.minutes + SNAP_MINUTES) };
  return spot.day === drag.day ? { ...drag, to: spot.minutes } : drag;
}

function finish(press: Press, handlers: DragHandlers): void {
  const { drag } = press;
  if (drag.kind === "move") {
    if (press.travelled) handlers.move(drag.entry, drag.to);
    else handlers.click(drag.entry, press.element);
  } else if (drag.kind === "resize") {
    if (press.travelled) handlers.resize(drag.entry, { day: drag.day, minutes: drag.bottom });
  } else {
    const from = Math.min(drag.from, drag.to);
    const to = Math.max(drag.from, drag.to) + SNAP_MINUTES;
    handlers.create(drag.day, press.travelled ? { from, to } : { from, to: from + 30 });
  }
}

/**
 * The gesture in progress (what a layout draws as its ghost), and the press
 * handlers its instances and slots take.
 */
export function useCalendarDrag(handlers: DragHandlers) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const latest = useRef(handlers);
  useLayoutEffect(() => {
    latest.current = handlers;
  });
  // The gesture in progress, ended without committing when the page goes away.
  const active = useRef<((commit: boolean) => void) | null>(null);
  useEffect(() => () => active.current?.(false), []);

  const begin = useCallback((event: ReactPointerEvent<HTMLElement>, first: Drag) => {
    if (event.button !== 0 || active.current !== null) return;
    event.stopPropagation();
    const press: Press = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      element: event.currentTarget,
      travelled: false,
      drag: first,
    };
    const ours = (next: PointerEvent) => next.pointerId === press.pointer;
    const onMove = (next: PointerEvent) => {
      if (!ours(next)) return;
      if (!press.travelled && Math.hypot(next.clientX - press.x, next.clientY - press.y) < SLOP)
        return;
      press.travelled = true;
      press.drag = moved(press.drag, spotAt(next));
      setDrag(press.drag);
    };
    const stop = (commit: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      active.current = null;
      setDrag(null);
      if (commit) finish(press, latest.current);
    };
    const onUp = (next: PointerEvent) => {
      if (ours(next)) stop(true);
    };
    const onCancel = (next: PointerEvent) => {
      if (ours(next)) stop(false);
    };
    active.current = stop;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }, []);

  /** Press an instance: move it, or click it. `grab` is the minute it was grabbed at, on the grid. */
  const pressEntry = useCallback(
    (event: ReactPointerEvent<HTMLElement>, entry: CalendarEntry, start: Spot) => {
      const spot = spotAt(event.nativeEvent);
      const grab =
        spot !== null && spot.minutes !== null && start.minutes !== null
          ? spot.minutes - start.minutes
          : 0;
      begin(event, { kind: "move", entry, grab, to: start });
    },
    [begin],
  );
  /** Press an instance's lower edge on the grid: resize it. */
  const pressEdge = useCallback(
    (
      event: ReactPointerEvent<HTMLElement>,
      entry: CalendarEntry,
      day: string,
      top: number,
      height: number,
    ) => begin(event, { kind: "resize", entry, day, top, bottom: top + height }),
    [begin],
  );
  /** Press an empty slot: make an instance there, over the minutes dragged across. */
  const pressSlot = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const spot = spotAt(event.nativeEvent);
      if (spot === null) return;
      if (spot.minutes === null) {
        if (event.button === 0) latest.current.create(spot.day, null);
        return;
      }
      const from = spot.minutes - (spot.minutes % 30);
      begin(event, { kind: "create", day: spot.day, from, to: from });
    },
    [begin],
  );
  return { drag, pressEntry, pressEdge, pressSlot };
}
