/**
 * Online sources for the query at hand. A link source (Pinterest, Are.na,
 * Unsplash, Lexica) is its search page, opened in a new tab: kb never calls
 * it, as its terms ask (research record §3). An API source (Civitai,
 * Openverse) is searched through `ext.gallery.search`, PG only, and a
 * result is kept through `ext.gallery.save`, with its page, creator and
 * licence on the visual.
 */
import { useState } from "react";
import { searchUrlOf, type ImageSource, type SourceResult } from "@kb/gallery";
import { cn } from "@kb/ui-sdk";
import { saveResult, searchSource, type SearchPage } from "./gallery-api";

const FIELD =
  "w-full rounded-md border border-border bg-transparent px-2 py-1 text-meta text-foreground/85";

function ResultCard({
  result,
  onSave,
}: {
  readonly result: SourceResult;
  /** Whether the save landed; a failed one has said why, and may be tried again. */
  readonly onSave: () => Promise<boolean>;
}) {
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const save = () => {
    setSaving("saving");
    void onSave().then((saved) => setSaving(saved ? "saved" : "idle"));
  };
  return (
    <figure data-gallery-result={result.id} className="flex flex-col gap-1">
      <a href={result.page} target="_blank" rel="noopener noreferrer" title={result.title}>
        <img
          src={result.thumb}
          alt={result.title}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="aspect-square w-full rounded-md border border-border object-cover"
        />
      </a>
      <figcaption className="flex flex-col gap-0.5">
        <span className="truncate text-label text-foreground/75">{result.title}</span>
        {result.licence !== undefined && (
          <span className="line-clamp-2 text-label text-foreground/40">{result.licence}</span>
        )}
        <button
          type="button"
          disabled={saving !== "idle"}
          className="self-start rounded-md border border-border px-1.5 py-0.5 text-label text-foreground/65 hover:bg-foreground/5 disabled:opacity-50"
          onClick={save}
        >
          {saving === "saved" ? "Saved" : saving === "saving" ? "Saving…" : "Save"}
        </button>
      </figcaption>
    </figure>
  );
}

function ApiSource({ source, query }: { readonly source: ImageSource; readonly query: string }) {
  const [page, setPage] = useState<SearchPage | null>(null);
  const [asked, setAsked] = useState("");
  const [busy, setBusy] = useState(false);
  // More continues the search that answered the page shown, whatever is typed since.
  const search = (asking: string, cursor?: string) => {
    setBusy(true);
    void searchSource(source.id, asking, cursor).then((answer) => {
      setBusy(false);
      if (answer === null) return;
      setAsked(asking);
      setPage((before) =>
        cursor === undefined || before === null
          ? answer
          : { results: [...before.results, ...answer.results], next: answer.next },
      );
    });
  };
  return (
    <section data-gallery-source={source.text} className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-meta text-foreground/80">{source.text}</span>
        <button
          type="button"
          disabled={busy || query.trim() === ""}
          className="rounded-md border border-border px-2 py-0.5 text-label text-foreground/70 hover:bg-foreground/5 disabled:opacity-50"
          onClick={() => search(query)}
        >
          {busy ? "Searching…" : "Search"}
        </button>
      </div>
      {page !== null && page.results.length === 0 && (
        <p className="text-label text-foreground/40">Nothing for “{asked}”.</p>
      )}
      {page !== null && page.results.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {page.results.map((result) => (
            <ResultCard
              key={result.id}
              result={result}
              onSave={() => saveResult(source.id, result).then((id) => id !== null)}
            />
          ))}
        </div>
      )}
      {page?.next !== undefined && (
        <button
          type="button"
          disabled={busy}
          className="text-label text-foreground/50 hover:text-foreground/80"
          onClick={() => search(asked, page.next)}
        >
          More from {source.text} for “{asked}”
        </button>
      )}
    </section>
  );
}

export function SourcesPanel({
  sources,
  suggested,
}: {
  readonly sources: readonly ImageSource[];
  /** The query the page suggests: the search text and the chosen styles. */
  readonly suggested: string;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const query = typed ?? suggested;
  const links = sources.filter((s) => s.kind === "link" && s.searchUrl !== "");
  const apis = sources.filter((s) => s.kind === "api");
  return (
    <div data-testid="gallery-sources" className="flex flex-col gap-3 p-3">
      <label className="flex flex-col gap-1">
        <span className="text-label text-foreground/45">Look for</span>
        <input
          value={query}
          placeholder="dolly zoom, golden hour…"
          className={FIELD}
          onChange={(e) => setTyped(e.target.value)}
        />
      </label>
      {links.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {links.map((source) => (
            <a
              key={source.id}
              href={query.trim() === "" ? undefined : searchUrlOf(source.searchUrl, query)}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={query.trim() === ""}
              className={cn(
                "rounded-md border border-border px-2 py-0.5 text-label text-foreground/70 hover:bg-foreground/5",
                query.trim() === "" && "pointer-events-none opacity-50",
              )}
            >
              {source.text} ↗
            </a>
          ))}
        </div>
      )}
      {apis.map((source) => (
        <ApiSource key={source.id} source={source} query={query} />
      ))}
      {sources.length === 0 && (
        <p className="text-label leading-snug text-foreground/40">
          No image sources: tag a node #image source with a search url to add one.
        </p>
      )}
    </div>
  );
}
