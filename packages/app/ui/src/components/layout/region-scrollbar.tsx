import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from "react";

/** The thumb's least height (px), so a long page's thumb is still a thing to grab. */
const LEAST_THUMB = 24;

/** Where a region's thumb stands: its height and its top (px), and whether the region overflows at all. */
function thumbOf(region: HTMLElement): { height: number; top: number; overflows: boolean } {
  const { clientHeight, scrollHeight, scrollTop } = region;
  const overflows = scrollHeight > clientHeight + 1;
  if (!overflows) return { height: clientHeight, top: 0, overflows };
  const height = Math.max(LEAST_THUMB, (clientHeight * clientHeight) / scrollHeight);
  const travel = Math.max(0, clientHeight - height);
  const reach = Math.max(1, scrollHeight - clientHeight);
  return { height, top: (scrollTop / reach) * travel, overflows };
}

/** Write a region's thumb's place to it, and whether the region overflows to its track. */
function placeThumb(
  scroller: HTMLElement | null,
  strip: HTMLElement | null,
  thumb: HTMLElement | null,
): void {
  if (!scroller || !thumb) return;
  const { height, top, overflows } = thumbOf(scroller);
  strip?.setAttribute("data-overflows", String(overflows));
  thumb.style.height = `${height}px`;
  thumb.style.transform = `translateY(${top}px)`;
}

/** A wheel's delta in pixels, whatever unit it came in. */
function wheelPixels(event: ReactWheelEvent, page: number): { x: number; y: number } {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? page : 1;
  return { x: event.deltaX * unit, y: event.deltaY * unit };
}

/**
 * The scroll region's scrollbar (`index.css`: the region keeps no gutter,
 * so a region-spanning backdrop runs to the pane's edge): a thin thumb in
 * a track over the region's right edge, which the content's own right
 * inset keeps clear (`index.css`). It shows while the
 * region scrolls (`data-scrolling`, `scrollbar-manager`), while it is
 * hovered and while it is dragged, as native overlay thumbs do, and
 * dragging it scrolls the region. Only the thumb takes the pointer — the
 * track passes it through to the region — and a wheel over the thumb
 * scrolls the region, so wheel, keyboard and touch scrolling are the
 * region's own everywhere. It is only seen while the region scrolls or
 * under the pointer, so that is when it is measured — on a scroll, as the
 * pointer comes over it, as a drag starts — and its place is written
 * straight to it, never through React state, so a scroll re-renders
 * nothing.
 */
export function RegionScrollbar({ region }: { readonly region: RefObject<HTMLElement | null> }) {
  const strip = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);

  const place = (): void => placeThumb(region.current, strip.current, thumb.current);

  useEffect(() => {
    const scroller = region.current;
    if (!scroller) return undefined;
    const onScroll = (): void => placeThumb(scroller, strip.current, thumb.current);
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [region]);

  const drag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const scroller = region.current;
    const grip = thumb.current;
    if (!scroller || !grip || event.button !== 0) return;
    place();
    event.preventDefault();
    grip.setPointerCapture(event.pointerId);
    grip.setAttribute("data-dragging", "true");
    const fromY = event.clientY;
    const fromTop = scroller.scrollTop;
    const { height } = thumbOf(scroller);
    const perPixel =
      (scroller.scrollHeight - scroller.clientHeight) / Math.max(1, scroller.clientHeight - height);
    const move = (next: PointerEvent): void => {
      scroller.scrollTop = fromTop + (next.clientY - fromY) * perPixel;
    };
    const end = (): void => {
      grip.removeAttribute("data-dragging");
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", end);
      grip.removeEventListener("pointercancel", end);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
  };

  const wheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    const scroller = region.current;
    if (!scroller) return;
    const { x, y } = wheelPixels(event, scroller.clientHeight);
    scroller.scrollBy({ left: x, top: y });
  };

  return (
    <div ref={strip} className="kb-region-scrollbar" data-overflows="false" aria-hidden="true">
      <div
        ref={thumb}
        className="kb-region-thumb"
        onPointerEnter={place}
        onPointerDown={drag}
        onWheel={wheel}
      />
    </div>
  );
}
