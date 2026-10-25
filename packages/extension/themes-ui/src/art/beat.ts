import { useEffect, useRef, useState } from "react";

/** How long after the art mounts a change still counts as its arrival. */
const ARRIVAL_MS = 1500;

/**
 * A count that steps each time `value` changes after the art has arrived,
 * so a gesture keyed on it replays once per change and never on arrival (a
 * boot and its redirects, a reload, switching to the system, are not
 * events). A change within `gap` ms of the last counted one is folded into
 * it, so a burst of writes is one gesture, not a stutter.
 */
export function useBeat(value: unknown, gap = 0): number {
  const [beat, setBeat] = useState(0);
  const last = useRef(value);
  const mounted = useRef<number | null>(null);
  const at = useRef(Number.NEGATIVE_INFINITY);
  useEffect(() => {
    mounted.current ??= performance.now();
    if (Object.is(last.current, value)) return;
    last.current = value;
    const now = performance.now();
    if (now - mounted.current < ARRIVAL_MS || now - at.current < gap) return;
    at.current = now;
    setBeat((b) => b + 1);
  }, [value, gap]);
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
