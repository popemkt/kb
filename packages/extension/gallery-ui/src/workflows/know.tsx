/**
 * I know what I want: the words first, made fast. A term typed is completed
 * from the style library (each suggestion named with its facet), and Enter
 * takes the first; a word the library does not have yet can join the brief
 * or become a style under a facet, so the library grows as it is used. The
 * references that show the look's styles appear under it as they are
 * chosen, every one of them when some do and, when none shows them all, the
 * ones that show the most; one opened can be pinned, and the online sources
 * search for the same words.
 */
import { useMemo, useState } from "react";
import {
  filterVisuals,
  nearest,
  orderedStyles,
  type StyleEntry,
  type WorkflowParams,
} from "@kb/gallery";
import { cn } from "@kb/ui-sdk";
import { DetailPanel } from "../detail-panel";
import { addDraftStyles, pinToDraft, toggleDraftStyle, updateDraft, useDraft } from "../draft";
import { useComposer, type ComposerFrame } from "../frame";
import { MasonryGrid } from "../masonry-grid";
import { selectionOf } from "../selection";
import { SourcesPanel } from "../sources-panel";
import { addStyle } from "../styles-api";
import { complete } from "./complete";
import { NoComposer } from "./no-composer";

function Term({ frame }: { readonly frame: ComposerFrame }) {
  const draft = useDraft();
  const [term, setTerm] = useState("");
  const [facet, setFacet] = useState(frame.library.facets[0]?.id ?? "");
  const hits = complete(frame.library, term, new Set(draft.styles));
  const had = complete(frame.library, term, new Set()).filter((s) => draft.styles.includes(s.id));
  const take = (id: string) => {
    toggleDraftStyle(id);
    setTerm("");
  };
  const toBrief = () => {
    updateDraft((d) => ({
      ...d,
      description: [d.description.trim(), term.trim()].filter(Boolean).join(", "),
    }));
    setTerm("");
  };
  const facetText = (s: StyleEntry) =>
    frame.library.facets.find((f) => f.id === s.facet)?.text ?? "";
  return (
    <div className="flex flex-col gap-2">
      <input
        value={term}
        autoFocus
        placeholder="Type a style: golden hour, low angle, 35mm…"
        aria-label="Name a style"
        className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-ui text-foreground/85"
        onChange={(e) => setTerm(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || term.trim() === "") return;
          e.preventDefault();
          const first = hits[0];
          if (first === undefined) toBrief();
          else take(first.id);
        }}
      />
      {term.trim() !== "" && (
        <div role="listbox" aria-label="Styles" className="flex flex-wrap gap-1">
          {hits.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="option"
              aria-selected={i === 0}
              data-gallery-suggestion={s.text}
              className={cn(
                "rounded-md border px-2 py-0.5 text-meta",
                i === 0
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border text-foreground/70",
              )}
              onClick={() => take(s.id)}
            >
              {s.text} <span className="text-label text-foreground/40">{facetText(s)}</span>
            </button>
          ))}
          {hits.length === 0 && had.length > 0 && (
            <span className="text-label text-foreground/55">
              Already in the look: {had.map((s) => s.text).join(", ")}
            </span>
          )}
          {hits.length === 0 && had.length === 0 && (
            <div className="flex flex-wrap items-center gap-2 text-label text-foreground/55">
              <span>Not in the library.</span>
              <button type="button" className="underline" onClick={toBrief}>
                Add “{term.trim()}” to the brief
              </button>
              {frame.library.facets.length > 0 && (
                <span className="flex items-center gap-1">
                  or make it a style under
                  <select
                    value={facet}
                    aria-label="Facet"
                    className="rounded-md border border-border bg-transparent px-1"
                    onChange={(e) => setFacet(e.target.value)}
                  >
                    {frame.library.facets.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.text}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void addStyle(term.trim(), facet).then(() => setTerm(""))}
                  >
                    Add
                  </button>
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function References({ frame }: { readonly frame: ComposerFrame }) {
  const { library } = frame;
  const draft = useDraft();
  const [openId, setOpenId] = useState<string | null>(null);
  const all = useMemo(
    () => filterVisuals(library, selectionOf(library, draft.styles), ""),
    [library, draft.styles],
  );
  const near = useMemo(
    () => (all.length > 0 || draft.styles.length === 0 ? [] : nearest(library, draft.styles)),
    [all, library, draft.styles],
  );
  const shown = all.length > 0 ? all : near.flatMap((id) => frame.node(id) ?? []);
  const open = openId === null ? undefined : frame.node(openId);
  if (open !== undefined) {
    return (
      <DetailPanel
        visual={open}
        library={library}
        chosen={new Set(draft.styles)}
        pinned={draft.pins.some((p) => p.visual === open.id)}
        onToggle={toggleDraftStyle}
        onUseStyles={() => addDraftStyles(library.stylesOf.get(open.id) ?? [])}
        onPin={() => pinToDraft(open.id)}
        onStartFrom={() => frame.open("reference", open.id)}
        onClose={() => setOpenId(null)}
      />
    );
  }
  const said =
    draft.styles.length === 0
      ? `Every visual in the library (${library.visuals.length})`
      : all.length > 0
        ? `${all.length} ${all.length === 1 ? "reference shows" : "references show"} all of it`
        : shown.length > 0
          ? "None shows all of it; these show the most"
          : "No reference shows any of it yet: find some online";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p data-testid="know-said" className="px-1 py-2 text-label text-foreground/50">
        {said}
      </p>
      {shown.length > 0 && (
        <div className="min-h-80 flex-1">
          <MasonryGrid
            key={draft.styles.join(",")}
            visuals={shown}
            selectedId={openId}
            onOpen={setOpenId}
          />
        </div>
      )}
    </div>
  );
}

function Know({ frame }: { readonly frame: ComposerFrame }) {
  const draft = useDraft();
  const [online, setOnline] = useState(false);
  const words = [
    draft.description.trim(),
    ...orderedStyles(frame.library, new Set(draft.styles)).map((s) => s.text),
  ]
    .filter((w) => w !== "")
    .join(" ");
  return (
    <div data-testid="gallery-know" className="flex h-full min-h-0 flex-col gap-2 p-3">
      <Term frame={frame} />
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-expanded={online}
          className="text-label text-foreground/55 hover:text-foreground/85"
          onClick={() => setOnline((o) => !o)}
        >
          {online ? "Hide the online sources" : "Find more online"}
        </button>
      </div>
      {online && (
        <SourcesPanel sources={frame.sources} suggested={words} onSaved={(id) => pinToDraft(id)} />
      )}
      <References frame={frame} />
    </div>
  );
}

export function KnowSurface(_props: { readonly params: WorkflowParams }) {
  const frame = useComposer();
  return frame === null ? <NoComposer /> : <Know frame={frame} />;
}
