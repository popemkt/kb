import { useLayoutEffect, useState } from "react";

/**
 * The class that breaks an element out of the shell's column to span the
 * scroll region's visible width (`100cqw` of the region), pulled back by the
 * shift `useBreakoutShift` measures; `index.css` states the rule.
 */
export const BREAKOUT_CLASS = "kb-breakout";

/**
 * A centered table or board breaks out of the shell's column to span the
 * scroll region's visible width (`BREAKOUT_CLASS`). CSS cannot know how far the element sits right of the region's
 * content edge: an indented outline child's parent is not centered on the
 * region, so `left: 50%` landed it off to the side and the page scrolled
 * sideways. Measure that offset and publish it as `--breakout-shift`; the
 * rule pulls the element back by it. The ref it returns is a callback, so
 * an element that mounts later, or another in its place, is measured too.
 */
export function useBreakoutShift(active: boolean): (element: HTMLElement | null) => void {
  const [element, setElement] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
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
  }, [active, element]);
  return setElement;
}
