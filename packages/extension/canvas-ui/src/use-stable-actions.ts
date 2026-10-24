import { useLayoutEffect, useRef, useState } from "react";

/** A bundle of handlers, each called with whatever it is called with. */
type Actions = Readonly<Record<string, (...args: never[]) => unknown>>;

/**
 * `actions` as one object that never changes for the component's life, each
 * member calling the handler of that name as of the last commit. What the
 * stage hands its items and edges: they are drawn again only when what they
 * draw changes, never because the page made its handlers anew.
 *
 * The names are read once, on the first render: a handler named later is
 * not forwarded. The handlers are taken in after each commit, in a layout
 * effect, so a child's own layout effect still calls those of the commit
 * before; call them from events and passive effects, as the stage does.
 */
export function useStableActions<T extends Actions>(actions: T): T {
  const latest = useRef(actions);
  useLayoutEffect(() => {
    latest.current = actions;
  });
  const [stable] = useState(() => {
    const forwarders = Object.fromEntries(
      Object.keys(actions).map((name) => [
        name,
        (...args: never[]) => latest.current[name]?.(...args),
      ]),
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- one forwarder per key of `actions`, each with its signature
    return forwarders as T;
  });
  return stable;
}
