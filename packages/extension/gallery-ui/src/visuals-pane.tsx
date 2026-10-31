/**
 * The visuals a selection and a search let through: the search box and
 * count over the virtualised masonry, with what to say when there are none.
 */
import { MasonryGrid } from "./masonry-grid";
import type { GraphNode, Library } from "@kb/gallery";
import type { References } from "./selection";

export function VisualsPane({
  library,
  shown,
  match,
  text,
  onText,
  gridKey,
  openId,
  onOpen,
  onFind,
}: {
  readonly library: Library;
  /** The visuals the selection and the search let through. */
  readonly shown: readonly GraphNode[];
  /** How `shown` answers the selection: the closest are said to be so. */
  readonly match: References["match"];
  readonly text: string;
  readonly onText: (text: string) => void;
  /** A new filter is a new grid: it starts at the top of its results. */
  readonly gridKey: string;
  readonly openId: string | null;
  readonly onOpen: (id: string) => void;
  /** Shows the sources, where an empty library is filled from. */
  readonly onFind: () => void;
}) {
  const total = library.visuals.length;
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-3 px-3 py-2">
        <input
          type="search"
          value={text}
          placeholder="Search titles and prompts"
          aria-label="Search the gallery"
          className="w-72 min-w-0 rounded-md border border-border bg-transparent px-2 py-1 text-meta text-foreground/85"
          onChange={(e) => onText(e.target.value)}
        />
        <span
          data-testid="gallery-count"
          className="shrink-0 text-label text-foreground/45 tabular-nums"
        >
          {match === "most"
            ? `${shown.length} closest`
            : shown.length === total
              ? `${total} ${total === 1 ? "visual" : "visuals"}`
              : `${shown.length} of ${total}`}
        </span>
      </div>
      {total === 0 ? (
        <div className="flex flex-col items-start gap-2 px-4 py-6">
          <p className="text-meta text-foreground/45">
            No visuals yet: save some from the sources, or tag a node with an image #visual.
          </p>
          <button
            type="button"
            className="rounded-md border border-border px-2 py-0.5 text-label text-foreground/70 hover:bg-foreground/5"
            onClick={onFind}
          >
            Find references in the sources
          </button>
        </div>
      ) : shown.length === 0 ? (
        <p className="px-4 py-6 text-meta text-foreground/45">
          No visual matches. Clear a facet or the search.
        </p>
      ) : (
        <>
          {match === "most" && (
            <p className="px-3 pb-1 text-label text-foreground/50">
              None shows all of the look: these show the most of it. Clear a facet to widen.
            </p>
          )}
          <MasonryGrid key={gridKey} visuals={shown} selectedId={openId} onOpen={onOpen} />
        </>
      )}
    </main>
  );
}
