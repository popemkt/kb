import { useEffect, useState } from "react";
import {
  BackdropFrame,
  BackdropPoint,
  HoldStill,
  useContributions,
  usePageBackdrop,
  type PageActivity,
  type PointerSource,
} from "@kb/ui-sdk";
import { BackdropThemeTag } from "@/backdrop-theme-tag";

/** The width a card draws its backdrop's frame at, then scales into the card: a side panel's, the narrowest a head is drawn. */
const FRAME_WIDTH = 480;
/** A sample hears no owner: nothing is being typed or written, and no pointer is over it. */
const QUIET: PageActivity = { editing: false, writes: 0 };
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
 * A backdrop as a card: its own renderer, drawn in its own frame at a side
 * panel's width and scaled into the card, as a still (`HoldStill`), at the
 * strength and direction the page is set to; under it, the theme it
 * belongs to. It is what the field editor's gallery draws for each option
 * of the backdrop field (DESIGN-UI.md → Field values → option galleries).
 * The frame mounts when the card is first on screen, so a gallery costs
 * what it shows.
 */
export default function BackdropCard({ id }: { readonly id: string }) {
  const backdrop = useContributions(BackdropPoint).find(({ value }) => value.key.id === id);
  const { strength, direction } = usePageBackdrop();
  const [box, setBox] = useState<HTMLSpanElement | null>(null);
  const { seen, width } = useSeen(box);
  if (backdrop === undefined) return null;
  const { presentation } = backdrop.value;
  return (
    <span className="flex flex-col gap-1.5" data-option-card={id}>
      <span
        ref={setBox}
        aria-hidden="true"
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
              opacity={presentation.opacity[strength]}
              activity={QUIET}
              pointer={NO_POINTER}
            />
          </HoldStill>
        ) : null}
      </span>
      <BackdropThemeTag id={id} />
    </span>
  );
}
