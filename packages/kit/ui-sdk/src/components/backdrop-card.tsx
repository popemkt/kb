import { useEffect, useState } from "react";
import type { BackdropStrength } from "@kb/model";
import { useBackdrops, usePageBackdrop } from "../hooks";
import { cardWindowTop } from "../lib/backdrop-card-window";
import { QUIET_ACTIVITY } from "../lib/plugins";
import { NO_POINTER } from "../lib/pointer-over";
import { HoldStill } from "./hold-still";
import { BackdropFrame } from "./page-backdrop";

/** The width a card draws its backdrop's frame at, then scales into the card: a side panel's, the narrowest a head is drawn. */
const FRAME_WIDTH = 480;
/** The card's size in CSS pixels. */
interface CardSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Whether the card has been on screen, and its size since: nothing is
 * mounted for a card never seen, and the frame scales to the card.
 */
function useSeen(box: HTMLElement | null): { readonly seen: boolean; readonly size: CardSize } {
  const [seen, setSeen] = useState(false);
  const [size, setSize] = useState<CardSize>({ width: 0, height: 0 });
  useEffect(() => {
    if (box === null) return undefined;
    const measure = () =>
      setSize((before) =>
        before.width === box.clientWidth && before.height === box.clientHeight
          ? before
          : { width: box.clientWidth, height: box.clientHeight },
      );
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
  return { seen, size };
}

/**
 * A backdrop's card window: its own renderer, drawn in its own frame at a
 * side panel's width and scaled into the card, looking at the band of it a
 * head's title stands in (`cardWindowTop`), as a still (`HoldStill`), at
 * the direction the page is set to and the strength in force, unless the
 * gallery shows it at one of its own (`strength`). The frame mounts when the
 * card is first on screen, so a gallery costs what it shows. Every gallery
 * of backdrops draws its cards with it: Settings' backdrop field (its
 * option preview, which sets it over the theme it belongs to) and the
 * backdrops' own studio.
 */
export function BackdropCard({
  id,
  strength: shown,
}: {
  readonly id: string;
  /** The strength the card shows; by default the one in force (a setting's preview shows what it sets). */
  readonly strength?: BackdropStrength;
}) {
  const backdrop = useBackdrops().shown.find(({ value }) => value.key.id === id);
  const { strength: inForce, direction, art, variants } = usePageBackdrop();
  const strength = shown ?? inForce;
  const [box, setBox] = useState<HTMLSpanElement | null>(null);
  const { seen, size } = useSeen(box);
  if (backdrop === undefined) return null;
  const scale = size.width / FRAME_WIDTH;
  const top =
    scale > 0 ? cardWindowTop(backdrop.value.presentation, direction, size.height / scale) : 0;
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
              top: -top * scale,
              width: FRAME_WIDTH,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
            color="var(--primary)"
            node={undefined}
            strength={strength}
            direction={direction}
            art={art}
            pinned={variants}
            activity={QUIET_ACTIVITY}
            pointer={NO_POINTER}
          />
        </HoldStill>
      ) : null}
    </span>
  );
}
