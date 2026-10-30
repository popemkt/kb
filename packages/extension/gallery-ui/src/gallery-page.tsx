/**
 * The gallery page (DESIGN-UI.md → The gallery): the facet rail, the
 * virtualised masonry of every visual the selection and the search text
 * let through, and a side panel that is the open visual's detail, the
 * composer or the online sources. Everything is read from the page's
 * replica (`useNodes`) by `@kb/gallery`'s pure readings, so a filter is a
 * pass over memory, never a call.
 *
 * In a narrow viewport (a phone; `useNarrowViewport`, the sidebar's own
 * breakpoint) the three columns cannot stand side by side, so the page
 * shows one pane at a time under a row of tabs, as Settings shows its parts:
 * the visuals, the facets, the composer or the sources, and an open visual's
 * detail in place of whichever is shown.
 */
import { useDeferredValue, useMemo, useState } from "react";
import {
  facetCounts,
  filterVisuals,
  imageSourcesOf,
  libraryOf,
  orderedStyles,
  STARTER_SIZE,
  type FacetSelection,
  type GraphNode,
  type Library,
} from "@kb/gallery";
import { cn, useNarrowViewport, useNodes, WorkspaceState } from "@kb/ui-sdk";
import { ComposePanel } from "./compose-panel";
import { DetailPanel } from "./detail-panel";
import { FacetRail } from "./facet-rail";
import { addStarter } from "./gallery-api";
import { MasonryGrid } from "./masonry-grid";
import { chosenStyles, liveSelection, selectionOf, toggleStyle } from "./selection";
import { SourcesPanel } from "./sources-panel";

/** What the page shows beside, or in a narrow viewport instead of, the grid. */
type Pane = "visuals" | "facets" | "compose" | "sources";

const PANE_LABELS: Readonly<Record<Pane, string>> = {
  visuals: "Visuals",
  facets: "Facets",
  compose: "Compose",
  sources: "Sources",
};
/** The panes a tab row offers: the side panel's two, or, in a narrow viewport, all four. */
const SIDE_PANES: readonly Pane[] = ["compose", "sources"];
const NARROW_PANES: readonly Pane[] = ["visuals", "facets", "compose", "sources"];

function Starter() {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
      <WorkspaceState
        title="A library of looks"
        description={`Visuals are nodes tagged #visual, filed by styles tagged #style under facets tagged #facet. Start with ${STARTER_SIZE.facets} facets and ${STARTER_SIZE.styles} styles (shot, angle, motion, lens, lighting, palette, …), then save references from the sources.`}
      />
      <button
        type="button"
        disabled={busy}
        data-testid="gallery-starter"
        className="rounded-md border border-border px-3 py-1.5 text-meta text-foreground/75 hover:bg-foreground/5 disabled:opacity-50"
        onClick={() => {
          setBusy(true);
          void addStarter().then(() => setBusy(false));
        }}
      >
        Add the starter library
      </button>
    </div>
  );
}

function Tabs({
  panes,
  shown,
  onPick,
}: {
  readonly panes: readonly Pane[];
  /** The pane whose tab is chosen; none while a visual's detail stands in for it. */
  readonly shown: Pane | null;
  readonly onPick: (pane: Pane) => void;
}) {
  return (
    <div role="tablist" className="flex shrink-0 gap-1 border-b border-border px-3 py-2">
      {panes.map((pane) => (
        <button
          key={pane}
          type="button"
          role="tab"
          aria-selected={shown === pane}
          className={cn(
            "rounded-md px-2 py-0.5 text-meta",
            shown === pane
              ? "bg-foreground/10 text-foreground/85"
              : "text-foreground/55 hover:text-foreground/80",
          )}
          onClick={() => onPick(pane)}
        >
          {PANE_LABELS[pane]}
        </button>
      ))}
    </div>
  );
}

function VisualsPane({
  library,
  shown,
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
          {shown.length === total
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
        <MasonryGrid key={gridKey} visuals={shown} selectedId={openId} onOpen={onOpen} />
      )}
    </main>
  );
}

export default function GalleryPage() {
  const nodes = useNodes();
  const library = useMemo(() => libraryOf(nodes.values()), [nodes]);
  const sources = useMemo(() => imageSourcesOf(nodes.values()), [nodes]);
  const [chosenIds, setSelection] = useState<FacetSelection>(new Map());
  // A chosen style read where it is now: one moved is under its new facet, one deleted is gone.
  const selection = useMemo(() => liveSelection(library, chosenIds), [library, chosenIds]);
  const [text, setText] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const narrow = useNarrowViewport();
  // One choice of pane: a narrow viewport shows it alone; a wide one keeps the
  // grid and the facets and shows the composer or the sources beside them.
  const [pane, setPane] = useState<Pane>(narrow ? "visuals" : "compose");
  // Typing stays responsive at fifty thousand visuals: the filter follows it.
  const deferredText = useDeferredValue(text);
  const shown = useMemo(
    () => filterVisuals(library, selection, deferredText),
    [library, selection, deferredText],
  );
  const counts = useMemo(
    () => facetCounts(library, selection, deferredText),
    [library, selection, deferredText],
  );
  const chosen = chosenStyles(selection);
  const styles = orderedStyles(library, chosen);
  const toggle = (id: string) =>
    setSelection((s) => toggleStyle(library, liveSelection(library, s), id));
  const open: GraphNode | undefined = openId === null ? undefined : nodes.get(openId);

  if (library.facets.length === 0 && library.visuals.length === 0) return <Starter />;
  // Picking a tab closes an open visual: the tab names what is shown.
  const pick = (next: Pane) => {
    setOpenId(null);
    setPane(next);
  };
  const rail = (
    <FacetRail
      library={library}
      selection={selection}
      counts={counts}
      onToggle={toggle}
      onClear={() => setSelection(new Map())}
    />
  );
  const grid = (
    <VisualsPane
      library={library}
      shown={shown}
      text={text}
      onText={setText}
      gridKey={`${[...chosen].join(",")}|${deferredText}`}
      openId={openId}
      onOpen={setOpenId}
      onFind={() => pick("sources")}
    />
  );
  const side =
    pane === "sources" ? (
      <SourcesPanel
        sources={sources}
        suggested={[text.trim(), ...styles.map((s) => s.text)].filter((p) => p !== "").join(" ")}
      />
    ) : (
      <ComposePanel styles={styles} onRemove={toggle} />
    );
  const detail =
    open === undefined ? null : (
      <DetailPanel
        visual={open}
        library={library}
        chosen={chosen}
        onToggle={toggle}
        onUseStyles={() => setSelection(selectionOf(library, library.stylesOf.get(open.id) ?? []))}
        onClose={() => setOpenId(null)}
      />
    );

  if (narrow) {
    const alone =
      pane === "visuals" ? (
        grid
      ) : pane === "facets" ? (
        rail
      ) : (
        <div className="overflow-y-auto">{side}</div>
      );
    return (
      <div data-testid="gallery-page" className="flex h-full min-h-0 flex-col">
        <Tabs panes={NARROW_PANES} shown={detail === null ? pane : null} onPick={pick} />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{detail ?? alone}</div>
      </div>
    );
  }
  return (
    <div data-testid="gallery-page" className="flex h-full min-h-0">
      {rail}
      {grid}
      <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-border">
        {detail ?? (
          <>
            <Tabs
              panes={SIDE_PANES}
              shown={pane === "sources" ? "sources" : "compose"}
              onPick={pick}
            />
            {side}
          </>
        )}
      </aside>
    </div>
  );
}
