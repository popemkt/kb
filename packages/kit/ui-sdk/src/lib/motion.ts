/**
 * The one reader of `prefers-reduced-motion`, as the person's motion mode
 * sets it (DESIGN-UI.md → Motion options): `<html data-motion>` says
 * `reduced` or `off` (reduce, whatever the OS says), `full` (never), or
 * `system` (ask the OS), which is also the answer before it is painted.
 *
 * CSS motion is flattened by the global rule in `index.css`; this is the same
 * question asked from script, for motion CSS cannot see — camera tweens, the
 * theme View Transition, a WebGL scene's animation loop.
 *
 * A subtree may hold still whatever the mode (`HeldStill`, drawn by
 * `HoldStill`): a sample drawn to be chosen by, such as a backdrop's option
 * card, is a still, as everything is under reduced motion. Its element says
 * so to CSS with the same `data-motion`, which the global rule reads on any
 * element, not only `<html>`.
 */
import { createContext, useContext, useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function query(): MediaQueryList | null {
  return typeof window === "undefined" || typeof window.matchMedia !== "function"
    ? null
    : window.matchMedia(QUERY);
}

/** The motion mode painted on `<html>`, or null before it is (or with no document). */
function paintedMode(): string | null {
  return typeof document === "undefined"
    ? null
    : document.documentElement.getAttribute("data-motion");
}

export function prefersReducedMotion(): boolean {
  const mode = paintedMode();
  if (mode === "reduced" || mode === "off") return true;
  if (mode === "full") return false;
  return query()?.matches === true;
}

function subscribe(onChange: () => void): () => void {
  const list = query();
  // A test double may hand back a bare `{ matches }` with no listener API.
  const listens = list !== null && typeof list.addEventListener === "function";
  if (listens) list.addEventListener("change", onChange);
  const observer =
    typeof MutationObserver === "function" && typeof document !== "undefined"
      ? new MutationObserver(onChange)
      : null;
  observer?.observe(document.documentElement, { attributeFilter: ["data-motion"] });
  return () => {
    if (listens) list.removeEventListener("change", onChange);
    observer?.disconnect();
  };
}

/** Whether the subtree holds still whatever the motion mode (`HoldStill`). */
export const HeldStill = createContext(false);

/**
 * `prefersReducedMotion`, re-read when the user changes the setting; always
 * true inside a subtree that holds still.
 */
export function useReducedMotion(): boolean {
  const held = useContext(HeldStill);
  const reduced = useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
  return held || reduced;
}
