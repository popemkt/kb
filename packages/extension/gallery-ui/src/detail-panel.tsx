/**
 * One visual, large: its image, where it came from and on what terms, the
 * prompt it was made with, and its styles. A style chip toggles it in the
 * selection; "Use its styles" makes the visual's styles the selection, so
 * the grid shows its kin and the composer its look.
 */
import {
  coverOf,
  creditOf,
  negativeOf,
  promptOf,
  sourceUrlOf,
  type GraphNode,
  type Library,
} from "@kb/gallery";
import { assetSrcUrl, cn, navigate, nodePath } from "@kb/ui-sdk";
import { copyText } from "./copy";

function CopyLine({ label, text }: { readonly label: string; readonly text: string }) {
  if (text === "") return null;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between">
        <span className="text-label text-foreground/45">{label}</span>
        <button
          type="button"
          className="text-label text-foreground/55 hover:text-foreground/85"
          onClick={() => copyText(text, label)}
        >
          Copy
        </button>
      </div>
      <p className="text-meta break-words whitespace-pre-wrap text-foreground/75 select-text">
        {text}
      </p>
    </div>
  );
}

export function DetailPanel({
  visual,
  library,
  chosen,
  onToggle,
  onUseStyles,
  onClose,
}: {
  readonly visual: GraphNode;
  readonly library: Library;
  readonly chosen: ReadonlySet<string>;
  readonly onToggle: (styleId: string) => void;
  readonly onUseStyles: () => void;
  readonly onClose: () => void;
}) {
  const cover = coverOf(visual);
  const source = sourceUrlOf(visual);
  const styles = library.stylesOf.get(visual.id) ?? [];
  return (
    <div data-testid="gallery-detail" className="flex flex-col gap-3 p-3">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-ui font-medium break-words text-foreground/85">{visual.text}</h2>
        <button
          type="button"
          className="shrink-0 text-label text-foreground/45 hover:text-foreground/75"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      {cover !== null && (
        <a href={assetSrcUrl(cover)} target="_blank" rel="noopener noreferrer">
          <img
            src={assetSrcUrl(cover)}
            alt={visual.text}
            className="max-h-96 w-full rounded-md border border-border object-contain"
          />
        </a>
      )}
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          className="rounded-md border border-border px-2 py-0.5 text-label text-foreground/70 hover:bg-foreground/5"
          onClick={() => navigate(nodePath(visual.id))}
        >
          Open node
        </button>
        {styles.length > 0 && (
          <button
            type="button"
            className="rounded-md border border-border px-2 py-0.5 text-label text-foreground/70 hover:bg-foreground/5"
            onClick={onUseStyles}
          >
            Use its styles
          </button>
        )}
        {source !== null && (
          <a
            href={source}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-border px-2 py-0.5 text-label text-foreground/70 hover:bg-foreground/5"
          >
            Source ↗
          </a>
        )}
      </div>
      {creditOf(visual) !== "" && (
        <p className="text-label text-foreground/50">{creditOf(visual)}</p>
      )}
      {styles.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {styles.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={chosen.has(id)}
              className={cn(
                "rounded-md px-1.5 py-0.5 text-label",
                chosen.has(id)
                  ? "bg-primary/10 text-primary"
                  : "bg-foreground/5 text-foreground/65 hover:text-foreground/85",
              )}
              onClick={() => onToggle(id)}
            >
              {library.styles.get(id)?.text ?? id}
            </button>
          ))}
        </div>
      )}
      <CopyLine label="Prompt" text={promptOf(visual)} />
      <CopyLine label="Negative prompt" text={negativeOf(visual)} />
    </div>
  );
}
