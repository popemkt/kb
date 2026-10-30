import { useEffect, useState } from "react";
import {
  BackdropFrame,
  BackdropPoint,
  HoldStill,
  useContributions,
  usePageBackdrop,
  QUIET_ACTIVITY,
  type PointerSource,
} from "@kb/ui-sdk";

/** The width a card draws its backdrop's frame at, then scales into the card: a side panel's, the narrowest a head is drawn. */
const FRAME_WIDTH = 480;
/** A sample hears no owner: nothing is being typed or written (`QUIET_ACTIVITY`), and no pointer is over it. */
const NO_POINTER: PointerSource = { now: () => null };

/**
 * Whether the card has been on screen, and its width since: nothing is
 * mounted for a card never seen, and the frame scales to the card.
 */
function useSeen(box: HTMLElement | null): { readonly seen: boolean; readonly width: number } {
  const [seen, setSeen] = useState(false);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (box === null) return undefined;
    const measure = () => setWidth(box.clientWidth);
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    const show = () => {
      setSeen(true);
      measure();
      resize?.observe(box);
    };
    if (typeof IntersectionObserver !== "function") {
      show();
      return () => resize?.disconnect();
    }
    const watch = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting !== true) return;
      watch.disconnect();
      show();
    });
    watch.observe(box);
    return () => {
      watch.disconnect();
      resize?.disconnect();
    };
  }, [box]);
  return { seen, width };
}

/**
 * A backdrop's card window: its own renderer, drawn in its own frame at a
 * side panel's width and scaled into the card, as a still (`HoldStill`), at
 * the strength and direction the page is set to (`BackdropPreview` sets it
 * over the theme it belongs to). The frame mounts when the card is first
 * on screen, so a gallery costs what it shows.
 */
export default function BackdropCard({ id }: { readonly id: string }) {
  const backdrop = useContributions(BackdropPoint).find(({ value }) => value.key.id === id);
  const { strength, direction, art } = usePageBackdrop();
  const [box, setBox] = useState<HTMLSpanElement | null>(null);
  const { seen, width } = useSeen(box);
  if (backdrop === undefined) return null;
  const { presentation } = backdrop.value;
  return (
    <span
      ref={setBox}
      aria-hidden="true"
      data-option-card={id}
      data-option-preview={id}
      className="relative block h-24 overflow-hidden rounded-md border border-border bg-background"
    >
      {seen ? (
        <HoldStill>
          <BackdropFrame
            id={id}
            backdrop={backdrop.value}
            placement={{
              left: 0,
              top: 0,
              width: FRAME_WIDTH,
              transform: `scale(${width / FRAME_WIDTH})`,
              transformOrigin: "top left",
            }}
            color="var(--primary)"
            node={undefined}
            strength={strength}
            direction={direction}
            art={art}
            opacity={presentation.opacity[strength]}
            activity={QUIET_ACTIVITY}
            pointer={NO_POINTER}
          />
        </HoldStill>
      ) : null}
    </span>
  );
}
