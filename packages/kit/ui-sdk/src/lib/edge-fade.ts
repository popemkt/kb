import { useLayoutEffect, useState } from "react";

/**
 * The class that fades the edge of a horizontal scroller past which more of
 * its content lies, so a board whose columns run past the pane shows they
 * go on; `index.css` states the rule. Which edges hide more is measured by
 * `useEdgeFade` and published as `data-more-start` and `data-more-end`.
 */
export const EDGE_FADE_CLASS = "kb-edge-fade";

/** Which ends of a horizontal scroller hide more of its content. */
export interface ScrollEdges {
  readonly start: boolean;
  readonly end: boolean;
}

/** What `scrollEdgesOf` reads of a scroller: how far it is scrolled, and how wide it and its content are. */
interface HorizontalScroll {
  readonly scrollLeft: number;
  readonly scrollWidth: number;
  readonly clientWidth: number;
}

/**
 * The edges past which `scroller` hides more of its content. A pixel's
 * slack is no more: a scroller at its end may stop a fraction short of it.
 */
export function scrollEdgesOf({
  scrollLeft,
  scrollWidth,
  clientWidth,
}: HorizontalScroll): ScrollEdges {
  return { start: scrollLeft > 1, end: scrollLeft + clientWidth < scrollWidth - 1 };
}

/**
 * Measure which edges of a horizontal scroller hide more of its content, as
 * it scrolls and as it or its content changes size, and mark them on it for
 * `EDGE_FADE_CLASS`. The marks are written straight to the element: a
 * scroll moves many times a frame, and nothing renders again while it does.
 * The ref it returns is a callback, so an element that mounts later, or
 * another in its place, is measured too.
 */
export function useEdgeFade(): (element: HTMLElement | null) => void {
  const [element, setElement] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (element === null) return undefined;
    const mark = (): void => {
      const edges = scrollEdgesOf(element);
      element.toggleAttribute("data-more-start", edges.start);
      element.toggleAttribute("data-more-end", edges.end);
    };
    mark();
    element.addEventListener("scroll", mark, { passive: true });
    const observer = new ResizeObserver(mark);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    return () => {
      element.removeEventListener("scroll", mark);
      observer.disconnect();
      element.removeAttribute("data-more-start");
      element.removeAttribute("data-more-end");
    };
  }, [element]);
  return setElement;
}
