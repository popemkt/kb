/**
 * The virtualised masonry: the layout of every shown visual is arithmetic
 * (`./masonry.ts`); only the tiles within a viewport of the window, either
 * way, are elements. Scrolling moves a window over the layout and swaps
 * which tiles exist; nothing grows with the library but the layout array.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { aspectOf, coverOf, type GraphNode } from "@kb/gallery";
import { assetSrcUrl, cn } from "@kb/ui-sdk";
import { layoutMasonry, visibleTiles, type MasonryOptions } from "./masonry";

const OPTIONS: MasonryOptions = { minColumn: 180, gap: 12, caption: 24 };

function useBox(element: HTMLElement | null): { width: number; height: number } {
  const [box, setBox] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (element === null) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return box;
}

function Tile({
  visual,
  selected,
  onOpen,
}: {
  readonly visual: GraphNode;
  readonly selected: boolean;
  readonly onOpen: (id: string) => void;
}) {
  const cover = coverOf(visual);
  return (
    <button
      type="button"
      data-gallery-tile={visual.id}
      aria-pressed={selected}
      className="group flex h-full w-full flex-col text-left"
      onClick={() => onOpen(visual.id)}
    >
      <span
        className={cn(
          "block min-h-0 flex-1 overflow-hidden rounded-md border bg-foreground/[0.04]",
          selected ? "border-primary" : "border-border group-hover:border-foreground/30",
        )}
      >
        {cover === null ? (
          <span className="flex h-full items-center justify-center text-label text-foreground/35">
            No image
          </span>
        ) : (
          <img
            src={assetSrcUrl(cover)}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            className="h-full w-full object-cover"
          />
        )}
      </span>
      <span className="truncate pt-1 text-label text-foreground/60">{visual.text}</span>
    </button>
  );
}

export function MasonryGrid({
  visuals,
  selectedId,
  onOpen,
}: {
  readonly visuals: readonly GraphNode[];
  readonly selectedId: string | null;
  readonly onOpen: (id: string) => void;
}) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const { width, height } = useBox(scroller);
  const [top, setTop] = useState(0);
  const frame = useRef<number | null>(null);
  const layout = useMemo(
    () => layoutMasonry(visuals.map(aspectOf), Math.max(0, width - OPTIONS.gap * 2), OPTIONS),
    [visuals, width],
  );
  const onScroll = () => {
    if (frame.current !== null || scroller === null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setTop(scroller.scrollTop);
    });
  };
  // One viewport of overscan each way, so a fling finds its tiles there.
  const shown = height === 0 ? [] : visibleTiles(layout, top - height, top + height * 2);
  return (
    <div
      ref={setScroller}
      data-testid="gallery-grid"
      data-gallery-shown={visuals.length}
      className="min-h-0 flex-1 overflow-y-auto px-3 pb-6"
      onScroll={onScroll}
    >
      <div className="relative w-full" style={{ height: layout.height }}>
        {shown.map((tile) => {
          const visual = visuals[tile.index];
          if (visual === undefined) return null;
          return (
            <div
              key={visual.id}
              className="absolute top-0 left-0"
              style={{
                transform: `translate(${tile.x}px, ${tile.y}px)`,
                width: tile.width,
                height: tile.height + layout.caption,
              }}
            >
              <Tile visual={visual} selected={visual.id === selectedId} onOpen={onOpen} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
