import { useEffect, useRef, useState } from "react";
import { THEME_GESTURE_MAX_MS } from "@kb/ui-sdk";

/** How long after the art mounts a change still counts as its arrival. */
const ARRIVAL_MS = 1500;

/** How long after an edit ends its text's last save may still land (the editor's save debounce, and the round trip). */
const HOLD_TAIL_MS = 900;

/**
 * A count that steps each time `value` changes after the art has arrived,
 * so a gesture keyed on it replays once per change and never on arrival (a
 * boot and its redirects, a reload, switching to the system, are not
 * events). A change within `gap` ms of the last counted one is folded into
 * it, so a burst of writes is one gesture, not a stutter. While `hold` is
 * true, and for `HOLD_TAIL_MS` after it turns false, a change is absorbed:
 * given the page's `editing`, the text's last save, which lands after the
 * editor has closed, never plays a write's gesture.
 */
export function useBeat(value: unknown, gap = 0, hold = false): number {
  const [beat, setBeat] = useState(0);
  const last = useRef(value);
  const mounted = useRef<number | null>(null);
  const at = useRef(Number.NEGATIVE_INFINITY);
  const held = useRef({ on: hold, until: Number.NEGATIVE_INFINITY });
  useEffect(() => {
    const now = performance.now();
    mounted.current ??= now;
    if (held.current.on && !hold) held.current.until = now + HOLD_TAIL_MS;
    held.current.on = hold;
    if (Object.is(last.current, value)) return;
    last.current = value;
    if (hold || now < held.current.until) return;
    if (now - mounted.current < ARRIVAL_MS || now - at.current < gap) return;
    at.current = now;
    setBeat((b) => b + 1);
  }, [value, gap, hold]);
  return beat;
}

/**
 * How many structural writes the graph has taken since the art mounted: a
 * write made while a node's text is being edited is typing, which the art
 * leaves alone.
 */
export function useStructuralWrites(writes: number, editing: boolean): number {
  // Derived while rendering from the change in `writes`, as React advises
  // for state that follows a prop: no effect, no second commit.
  const [seen, setSeen] = useState({ writes, count: 0 });
  if (writes === seen.writes) return seen.count;
  const next = { writes, count: editing ? seen.count : seen.count + 1 };
  setSeen(next);
  return next.count;
}

/**
 * The passing gesture `beat` keys: the key of the one drawn now, or null,
 * and `end`, for the gesture's `onAnimationEnd`. A beat that arrives while
 * none is drawn starts one, keyed per beat so it plays from its start; a
 * beat that arrives while one is drawn is merged into it, so the gesture
 * carries on rather than replaying from the start, and its end consumes
 * every beat it merged. A gesture is removed when its animation ends, and in
 * any case `ms` after it began: an animation that never ends (a hidden tab,
 * one cancelled or interrupted, reduced motion turned on or off midway)
 * cannot leave it on the page.
 */
export function useGesture(
  beat: number,
  ms: number = THEME_GESTURE_MAX_MS,
): { readonly key: number | null; readonly end: () => void } {
  // The beat the drawn gesture started on, and the last beat consumed.
  // Derived while rendering, as `useStructuralWrites` is.
  const [state, setState] = useState({ shown: 0, ended: 0 });
  let { shown } = state;
  if (beat > state.ended && shown <= state.ended) {
    shown = beat;
    setState({ shown, ended: state.ended });
  }
  // The latest beat, for an end that comes from a timer set before it.
  const latest = useRef(beat);
  useEffect(() => {
    latest.current = beat;
  }, [beat]);
  useEffect(() => {
    if (shown === 0) return undefined;
    const timer = setTimeout(
      () => setState((s) => ({ ...s, ended: Math.max(s.ended, latest.current) })),
      ms,
    );
    return () => clearTimeout(timer);
  }, [shown, ms]);
  return {
    key: shown > state.ended ? shown : null,
    end: () => setState((s) => ({ ...s, ended: Math.max(s.ended, beat) })),
  };
}
