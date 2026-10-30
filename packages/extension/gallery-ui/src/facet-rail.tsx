/**
 * The facet rail: each facet with its styles and how many visuals each
 * would show, counted as faceted search counts (`facetCounts`): OR within a
 * facet, AND across. A long facet shows its first styles and the chosen
 * ones until opened.
 */
import { useState } from "react";
import type { FacetEntry, FacetSelection, Library } from "@kb/gallery";
import { cn } from "@kb/ui-sdk";
import { chosenStyles } from "./selection";

const FOLDED = 10;

function StyleRow({
  label,
  count,
  chosen,
  onToggle,
}: {
  readonly label: string;
  readonly count: number;
  readonly chosen: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={chosen}
      data-gallery-style={label}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-0.5 text-left text-meta",
        chosen ? "bg-primary/10 text-primary" : "text-foreground/70 hover:bg-foreground/5",
        !chosen && count === 0 && "opacity-45",
      )}
      onClick={onToggle}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-label text-foreground/40 tabular-nums">{count}</span>
    </button>
  );
}

function FacetGroup({
  facet,
  library,
  counts,
  chosen,
  onToggle,
}: {
  readonly facet: FacetEntry;
  readonly library: Library;
  readonly counts: ReadonlyMap<string, number>;
  readonly chosen: ReadonlySet<string>;
  readonly onToggle: (styleId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const folded = !open && facet.styles.length > FOLDED;
  const listed = folded
    ? facet.styles.filter((id, i) => i < FOLDED || chosen.has(id))
    : facet.styles;
  return (
    <section className="flex flex-col gap-0.5" data-gallery-facet={facet.text}>
      <h3 className="px-2 pt-3 pb-1 text-label font-medium tracking-wide text-foreground/45 uppercase">
        {facet.text}
      </h3>
      {listed.map((id) => (
        <StyleRow
          key={id}
          label={library.styles.get(id)?.text ?? id}
          count={counts.get(id) ?? 0}
          chosen={chosen.has(id)}
          onToggle={() => onToggle(id)}
        />
      ))}
      {facet.styles.length > FOLDED && (
        <button
          type="button"
          className="px-2 py-0.5 text-left text-label text-foreground/45 hover:text-foreground/70"
          onClick={() => setOpen(!open)}
        >
          {open ? "Show fewer" : `Show all ${facet.styles.length}`}
        </button>
      )}
    </section>
  );
}

export function FacetRail({
  library,
  selection,
  counts,
  onToggle,
  onClear,
}: {
  readonly library: Library;
  readonly selection: FacetSelection;
  readonly counts: ReadonlyMap<string, number>;
  readonly onToggle: (styleId: string) => void;
  readonly onClear: () => void;
}) {
  const chosen = chosenStyles(selection);
  return (
    <aside data-testid="gallery-facets" className="flex min-h-0 w-full flex-col px-2 pb-6">
      <div className="flex items-center justify-between px-2 pt-3">
        <span className="text-ui font-medium text-foreground/80">Facets</span>
        {chosen.size > 0 && (
          <button
            type="button"
            className="text-label text-foreground/45 hover:text-foreground/75"
            onClick={onClear}
          >
            Clear {chosen.size}
          </button>
        )}
      </div>
      {library.facets.map((facet) => (
        <FacetGroup
          key={facet.id}
          facet={facet}
          library={library}
          counts={counts}
          chosen={chosen}
          onToggle={onToggle}
        />
      ))}
    </aside>
  );
}
