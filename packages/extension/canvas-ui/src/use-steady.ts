import { useEffect, useState } from "react";

/**
 * `value` as one object while it stays the `same`: what is memoized on it,
 * or compared by identity, holds until it really changes.
 */
export function useSteady<T>(value: T, same: (a: T, b: T) => boolean): T {
  const [held, setHeld] = useState(value);
  const moved = !same(held, value);
  if (moved) setHeld(value);
  return moved ? value : held;
}

/**
 * `value` as it last stood still for `restMs`: the first at once, then each
 * one that stays the `same` that long, and while it moves the one held
 * before.
 */
export function useAtRest<T>(value: T, same: (a: T, b: T) => boolean, restMs: number): T {
  const [rested, setRested] = useState(value);
  const moving = !same(rested, value);
  useEffect(() => {
    if (!moving) return undefined;
    const timer = setTimeout(() => setRested(value), restMs);
    return () => clearTimeout(timer);
  });
  return rested;
}
