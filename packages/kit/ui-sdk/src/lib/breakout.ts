import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * A centered table or board breaks out of the shell's column to span the
 * scroll region's visible width (`.table-view-breakout`, `100cqw` of the
 * region). CSS cannot know how far the element sits right of the region's
 * content edge: an indented outline child's parent is not centered on the
 * region, so `left: 50%` landed it off to the side and the page scrolled
 * sideways. Measure that offset and publish it as `--breakout-shift`; the
 * rule pulls the element back by it.
 */
export function useBreakoutShift<T extends HTMLElement>(active: boolean): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    const parent = element?.parentElement;
    const region = element?.closest<HTMLElement>("[data-main-region]");
    if (!active || !element || !parent || !region) return undefined;
    const measure = (): void => {
      const style = getComputedStyle(parent);
      const parentContentLeft =
        parent.getBoundingClientRect().left +
        parent.clientLeft +
        (Number.parseFloat(style.paddingLeft) || 0);
      const regionContentLeft = region.getBoundingClientRect().left + region.clientLeft;
      element.style.setProperty(
        "--breakout-shift",
        `${parentContentLeft - regionContentLeft + region.scrollLeft}px`,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(region);
    observer.observe(parent);
    return () => {
      observer.disconnect();
      element.style.removeProperty("--breakout-shift");
    };
  }, [active]);
  return ref;
}
