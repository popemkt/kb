/**
 * A row's preview (DESIGN-UI.md → Opening a node → a row's display options): the
 * view the node's tag opens it in, drawn small under the row, when the
 * node's preview display option is on (`RowOpening.shown`).
 *
 * It is cheap: it stands in a box of its family's `preview height`, so a
 * long outline never shifts, and mounts only once on screen, so it pays for
 * no preview it never shows.
 */
import { useEffect, useState } from "react";
import { Result } from "effect";
import type { NodeId } from "@kb/model";
import { ignoreReport, paramsFromProps } from "@kb/views";
import { cn, indentStyle, usePane, ViewSlot } from "@kb/ui-sdk";
import { openIn, type RowOpening } from "./row-opening";

/**
 * Whether the element given to the returned ref has come near the viewport;
 * once it has, it stays true. The element is state, so one that mounts after
 * its component (a preview opened later) is observed when it does.
 */
function useSeen(): readonly [(el: HTMLElement | null) => void, boolean] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  // Where nothing can tell (no IntersectionObserver), everything counts as seen.
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (seen || el === null) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, seen]);
  return [setEl, seen];
}

/**
 * The preview under the row, when it is on: the opening's view at placement
 * `preview`, in a box of its family's height, mounted once on screen.
 * Pressing it opens the node in that view.
 */
export function RowPreview({
  nodeId,
  opening,
  depth,
}: {
  readonly nodeId: NodeId;
  readonly opening: RowOpening;
  readonly depth: number;
}) {
  const pane = usePane();
  const [box, seen] = useSeen();
  if (!opening.shown.preview) return null;
  const params = paramsFromProps(opening.key, {}, nodeId, ignoreReport);
  if (Result.isFailure(params)) return null;
  return (
    <div className="pr-2 pb-1" style={indentStyle(depth + 1)} data-row-preview={nodeId}>
      <div
        ref={box}
        role="button"
        tabIndex={0}
        aria-label={`Open in ${opening.label}`}
        title={`Open in ${opening.label}`}
        className={cn(
          "relative w-full overflow-hidden rounded-md border border-border bg-foreground/[0.02]",
          "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        )}
        style={{ height: opening.settings.height }}
        onClick={() => openIn(pane, nodeId, opening.key)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          openIn(pane, nodeId, opening.key);
        }}
      >
        {seen ? (
          <ViewSlot
            view={opening.key}
            params={params.success}
            placement="preview"
            subject={nodeId}
            fallback={<span className="sr-only">No preview</span>}
          />
        ) : null}
      </div>
    </div>
  );
}
