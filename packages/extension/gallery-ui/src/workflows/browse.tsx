/**
 * Browse my library: every visual, filtered by facet, and the online
 * sources (DESIGN-UI.md → The gallery). The facet selection is the look's
 * styles, so what the grid shows is what the look asks for; a visual opened
 * can be pinned to the look, add its styles to it, or start the reference
 * workflow.
 *
 * Beside the grid one column shows the facets or the sources, and an open
 * visual's detail stands in for them. In a narrow viewport the grid is a
 * pane of its own under the same tabs.
 */
import { useDeferredValue, useMemo, useState } from "react";
import { facetCounts, filterVisuals, orderedStyles } from "@kb/gallery";
import { useNarrowViewport } from "@kb/ui-sdk";
import { DetailPanel } from "../detail-panel";
import { addDraftStyles, pinToDraft, toggleDraftStyle, updateDraft, useDraft } from "../draft";
import { FacetRail } from "../facet-rail";
import { useComposer, type ComposerFrame } from "../frame";
import { selectionOf } from "../selection";
import { SourcesPanel } from "../sources-panel";
import { Tabs } from "../tabs";
import { VisualsPane } from "../visuals-pane";
import { NoComposer } from "./no-composer";

type Pane = "visuals" | "facets" | "sources";

const PANES: ReadonlyArray<{ readonly id: Pane; readonly label: string }> = [
  { id: "visuals", label: "Visuals" },
  { id: "facets", label: "Facets" },
  { id: "sources", label: "Sources" },
];

function Browse({ frame }: { readonly frame: ComposerFrame }) {
  const { library } = frame;
  const draft = useDraft();
  const selection = useMemo(() => selectionOf(library, draft.styles), [library, draft.styles]);
  const [text, setText] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const narrow = useNarrowViewport();
  const [pane, setPane] = useState<Pane>(narrow ? "visuals" : "facets");
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
  const chosen = new Set(draft.styles);
  const open = openId === null ? undefined : frame.node(openId);
  // Picking a tab closes an open visual: the tab names what is shown.
  const pick = (next: Pane) => {
    setOpenId(null);
    setPane(next);
  };
  const grid = (
    <VisualsPane
      library={library}
      shown={shown}
      text={text}
      onText={setText}
      gridKey={`${draft.styles.join(",")}|${deferredText}`}
      openId={openId}
      onOpen={setOpenId}
      onFind={() => pick("sources")}
    />
  );
  const side =
    open !== undefined ? (
      <DetailPanel
        visual={open}
        library={library}
        chosen={chosen}
        pinned={draft.pins.some((p) => p.visual === open.id)}
        onToggle={toggleDraftStyle}
        onUseStyles={() => addDraftStyles(library.stylesOf.get(open.id) ?? [])}
        onPin={() => pinToDraft(open.id)}
        onStartFrom={() => frame.open("reference", open.id)}
        onClose={() => setOpenId(null)}
      />
    ) : pane === "sources" ? (
      <SourcesPanel
        sources={frame.sources}
        suggested={[text.trim(), ...orderedStyles(library, chosen).map((s) => s.text)]
          .filter((p) => p !== "")
          .join(" ")}
      />
    ) : (
      <FacetRail
        library={library}
        selection={selection}
        counts={counts}
        onToggle={toggleDraftStyle}
        onClear={() => updateDraft((d) => ({ ...d, styles: [] }))}
      />
    );
  const tabs = narrow ? PANES : PANES.filter((p) => p.id !== "visuals");
  const tab = open === undefined ? pane : null;
  if (narrow) {
    return (
      <div data-testid="gallery-browse" className="flex h-full min-h-0 flex-col">
        <Tabs label="Browse" tabs={tabs} shown={tab} onPick={pick} />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {pane === "visuals" && open === undefined ? grid : side}
        </div>
      </div>
    );
  }
  return (
    <div data-testid="gallery-browse" className="flex h-full min-h-0">
      <aside className="flex w-72 shrink-0 flex-col border-r border-border">
        <Tabs label="Browse" tabs={tabs} shown={tab} onPick={pick} />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{side}</div>
      </aside>
      {grid}
    </div>
  );
}

export function BrowseSurface() {
  const frame = useComposer();
  return frame === null ? <NoComposer /> : <Browse frame={frame} />;
}
