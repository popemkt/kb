/**
 * The gallery page (DESIGN-UI.md → The gallery): the facet rail, the
 * virtualised masonry of every visual the selection and the search text
 * let through, and a side panel that is the open visual's detail, the
 * composer or the online sources. Everything is read from the page's
 * replica (`useNodes`) by `@kb/gallery`'s pure readings, so a filter is a
 * pass over memory, never a call.
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
} from "@kb/gallery";
import { cn, useNodes, WorkspaceState } from "@kb/ui-sdk";
import { ComposePanel } from "./compose-panel";
import { DetailPanel } from "./detail-panel";
import { FacetRail } from "./facet-rail";
import { addStarter } from "./gallery-api";
import { MasonryGrid } from "./masonry-grid";
import { chosenStyles, selectionOf, toggleStyle } from "./selection";
import { SourcesPanel } from "./sources-panel";

type Panel = "compose" | "sources";

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

function PanelTabs({
  panel,
  onPick,
}: {
  readonly panel: Panel;
  readonly onPick: (p: Panel) => void;
}) {
  const tab = (value: Panel, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={panel === value}
      className={cn(
        "rounded-md px-2 py-0.5 text-meta",
        panel === value
          ? "bg-foreground/10 text-foreground/85"
          : "text-foreground/55 hover:text-foreground/80",
      )}
      onClick={() => onPick(value)}
    >
      {label}
    </button>
  );
  return (
    <div role="tablist" className="flex gap-1 border-b border-border px-3 py-2">
      {tab("compose", "Compose")}
      {tab("sources", "Sources")}
    </div>
  );
}

export default function GalleryPage() {
  const nodes = useNodes();
  const library = useMemo(() => libraryOf(nodes.values()), [nodes]);
  const sources = useMemo(() => imageSourcesOf(nodes.values()), [nodes]);
  const [selection, setSelection] = useState<FacetSelection>(new Map());
  const [text, setText] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("compose");
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
  const toggle = (id: string) => setSelection((s) => toggleStyle(library, s, id));
  const open: GraphNode | undefined = openId === null ? undefined : nodes.get(openId);

  if (library.facets.length === 0 && library.visuals.length === 0) return <Starter />;
  return (
    <div data-testid="gallery-page" className="flex h-full min-h-0">
      <FacetRail
        library={library}
        selection={selection}
        counts={counts}
        onToggle={toggle}
        onClear={() => setSelection(new Map())}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 px-3 py-2">
          <input
            type="search"
            value={text}
            placeholder="Search titles and prompts"
            aria-label="Search the gallery"
            className="w-72 rounded-md border border-border bg-transparent px-2 py-1 text-meta text-foreground/85"
            onChange={(e) => setText(e.target.value)}
          />
          <span data-testid="gallery-count" className="text-label text-foreground/45 tabular-nums">
            {shown.length === library.visuals.length
              ? `${library.visuals.length} ${library.visuals.length === 1 ? "visual" : "visuals"}`
              : `${shown.length} of ${library.visuals.length}`}
          </span>
        </div>
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-meta text-foreground/45">
            {library.visuals.length === 0
              ? "No visuals yet: save some from the sources, or tag a node with an image #visual."
              : "No visual matches. Clear a facet or the search."}
          </p>
        ) : (
          // A new filter is a new grid: it starts at the top of its results.
          <MasonryGrid
            key={`${[...chosen].join(",")}|${deferredText}`}
            visuals={shown}
            selectedId={openId}
            onOpen={setOpenId}
          />
        )}
      </main>
      <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-border">
        {open === undefined ? (
          <>
            <PanelTabs panel={panel} onPick={setPanel} />
            {panel === "compose" ? (
              <ComposePanel styles={styles} onRemove={toggle} />
            ) : (
              <SourcesPanel
                sources={sources}
                suggested={[text.trim(), ...styles.map((s) => s.text)]
                  .filter((p) => p !== "")
                  .join(" ")}
              />
            )}
          </>
        ) : (
          <DetailPanel
            visual={open}
            library={library}
            chosen={chosen}
            onToggle={toggle}
            onUseStyles={() =>
              setSelection(selectionOf(library, library.stylesOf.get(open.id) ?? []))
            }
            onClose={() => setOpenId(null)}
          />
        )}
      </aside>
    </div>
  );
}
