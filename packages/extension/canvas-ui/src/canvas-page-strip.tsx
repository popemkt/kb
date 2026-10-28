/**
 * The page strip: the pages of the board a canvas is on (`canvasPages`),
 * each by its node's text, the one showing marked, and "new page", which
 * adds a canvas under the board. ⌥← and ⌥→ turn the page. On a compact
 * stage it stands in the header's row, its current page naming the canvas,
 * and "new page" is its mark.
 */
import { PlusIcon } from "@phosphor-icons/react";
import { cn } from "@kb/ui-sdk";

export interface CanvasPageTab {
  readonly id: string;
  readonly label: string;
}

export function CanvasPageStrip({
  compact,
  pages,
  current,
  onOpen,
  onNew,
}: {
  /** The stage is compact (`compactStage`): the strip stands in the header's row. */
  compact: boolean;
  pages: readonly CanvasPageTab[];
  current: string;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <nav
      aria-label="Pages"
      className={cn(
        "flex items-center gap-1 overflow-x-auto",
        compact ? "min-w-0 flex-1" : "h-8 shrink-0 border-b border-foreground/[0.06] px-3",
      )}
    >
      {pages.map((page) => (
        <button
          key={page.id}
          type="button"
          aria-current={page.id === current ? "page" : undefined}
          title={page.id === current ? undefined : "Open this page (⌥← ⌥→)"}
          className={cn(
            "shrink-0 rounded-md px-2 py-0.5 text-label",
            page.id === current
              ? "bg-foreground/[0.07] text-foreground/85"
              : "text-foreground/50 hover:bg-foreground/5 hover:text-foreground/80",
          )}
          onClick={() => onOpen(page.id)}
        >
          {page.label}
        </button>
      ))}
      <button
        type="button"
        aria-label="New page"
        className="flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-label text-foreground/40 hover:bg-foreground/5 hover:text-foreground/75"
        onClick={onNew}
      >
        <PlusIcon size={12} />
        {!compact && "New page"}
      </button>
    </nav>
  );
}
