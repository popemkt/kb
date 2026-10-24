import { useEffect, useRef, useState, type RefObject } from "react";

interface Observed {
  readonly element: HTMLElement;
  readonly observer: ResizeObserver;
}

/**
 * The stage's size on screen, kept current as it resizes. The stage mounts
 * only once its canvas node is known, so after each render the observer
 * follows whatever element the ref holds now.
 */
export function useStageSize(stage: RefObject<HTMLElement | null>): {
  width: number;
  height: number;
} {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observed = useRef<Observed | null>(null);

  useEffect(() => {
    const element = stage.current;
    if (observed.current?.element === element) return;
    observed.current?.observer.disconnect();
    observed.current = null;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setSize({ width: element.clientWidth, height: element.clientHeight });
    });
    observer.observe(element);
    observed.current = { element, observer };
  });

  useEffect(
    () => () => {
      observed.current?.observer.disconnect();
      observed.current = null;
    },
    [],
  );
  return size;
}
