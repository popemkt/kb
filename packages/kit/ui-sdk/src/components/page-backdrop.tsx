import { useCallback, type CSSProperties, type Ref } from "react";
import { shownVariants } from "@kb/model";
import { useAppearance, usePageActivity, usePageBackdrop } from "../hooks";
import { BREAKOUT_CLASS, useBreakoutShift } from "../lib/breakout";
import { cn } from "../lib/cn";
import type { Backdrop, BackdropPresentation, BackdropProps } from "../lib/plugins";
import { usePointerOver } from "../lib/pointer-over";
import type { OutlineNode } from "../lib/types";

/**
 * A backdrop's frame: the box its component draws in, as tall as its
 * presentation says, clipped, inert and hidden, carrying which backdrop it
 * is and which way it faces. Where the frame stands is its host's
 * (`placement`, and a class that places it): a page head centres it under
 * the head or spans the scroll region with it, a card scales it into the
 * card. Of the variants its settings pin, it tells the component those it
 * may show on this page's scheme (`shownVariants`), the one place that is
 * decided.
 */
export function BackdropFrame({
  id,
  backdrop: { key, presentation, Component },
  placement,
  className,
  frameRef,
  pinned,
  ...props
}: Omit<BackdropProps, "variants"> & {
  readonly id: string;
  readonly backdrop: Backdrop;
  readonly placement: CSSProperties;
  readonly className?: string;
  readonly frameRef?: Ref<HTMLDivElement>;
  /** The variants pinned, by declared id (`PageBackdropChoice.variants`). */
  readonly pinned: readonly string[];
}) {
  const { dark } = useAppearance();
  const variants = shownVariants(key, pinned, dark ? "dark" : "light");
  return (
    <div
      ref={frameRef}
      className={cn("kb-header-backdrop pointer-events-none", className)}
      data-backdrop={id}
      data-direction={props.direction}
      style={{
        position: "absolute",
        overflow: "hidden",
        height: presentation.height,
        ...placement,
      }}
      aria-hidden="true"
      data-header-wash="true"
    >
      <Component {...props} variants={variants} />
    </div>
  );
}

/** Where a page head stands its frame: by its span, at its offset. */
function placementOf({ span, offset }: BackdropPresentation): {
  readonly placement: CSSProperties;
  readonly className?: string;
} {
  if (span.reach === "region")
    return { placement: { left: 0, top: offset }, className: BREAKOUT_CLASS };
  return {
    placement: {
      left: "50%",
      width: "100%",
      transform: "translateX(-50%)",
      maxWidth: span.maxWidth,
      top: offset,
    },
  };
}

/**
 * The one page-head slot (DESIGN-UI.md → Page-head backdrops): the chosen
 * backdrop, framed by its presentation, painted behind the head's content.
 * Every page head renders this, with its colour and the node it shows, and
 * names no backdrop; with none contributed it renders nothing. Which one,
 * how strong and which way are settings (`usePageBackdrop`): the node's own,
 * then core's. The outline's heads render it; canvas and graph pages have
 * no head yet, so nothing renders it there. GAP [[01M54CEKJJXNDPYNT55AR6KEV8]]
 */
export function PageBackdrop({ color, node }: { color: string; node?: OutlineNode }) {
  const { backdrop: chosen, strength, direction, art, variants } = usePageBackdrop(node);
  const activity = usePageActivity();
  const [pointer, attachFrame] = usePointerOver();
  const spansRegion = chosen?.value.presentation.span.reach === "region";
  const shift = useBreakoutShift(spansRegion);
  const frameRef = useCallback(
    (frame: HTMLDivElement | null) => {
      shift(frame);
      const detach = attachFrame(frame);
      return () => {
        shift(null);
        detach?.();
      };
    },
    [attachFrame, shift],
  );
  if (chosen === null) return null;
  const { presentation } = chosen.value;
  return (
    <div
      className="kb-header-backdrop-space relative pointer-events-none"
      style={{ height: `min(${presentation.space}px, 24vw)` }}
      aria-hidden="true"
    >
      <BackdropFrame
        id={chosen.id}
        backdrop={chosen.value}
        frameRef={frameRef}
        {...placementOf(presentation)}
        color={color}
        node={node}
        strength={strength}
        direction={direction}
        art={art}
        pinned={variants}
        opacity={presentation.opacity[strength]}
        activity={activity}
        pointer={pointer}
      />
    </div>
  );
}
