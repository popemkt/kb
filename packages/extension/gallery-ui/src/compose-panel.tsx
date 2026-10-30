/**
 * The composer: a subject, the chosen styles applied in facet order by the
 * A1111 rule (`composePrompt`), for one model family. The chosen styles are
 * the facet selection itself, so what the grid shows is what the prompt
 * asks for.
 */
import { useState } from "react";
import { COMPOSE_TARGETS, composePrompt, type ComposeTarget, type StyleEntry } from "@kb/gallery";
import { cn } from "@kb/ui-sdk";
import { copyText } from "./copy";

function Output({ label, text }: { readonly label: string; readonly text: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-label text-foreground/45">{label}</span>
        <button
          type="button"
          disabled={text === ""}
          className="text-label text-foreground/55 hover:text-foreground/85 disabled:opacity-40"
          onClick={() => copyText(text, label)}
        >
          Copy
        </button>
      </div>
      <p
        data-gallery-output={label}
        className="min-h-12 rounded-md border border-border bg-foreground/[0.03] px-2 py-1.5 text-meta break-words whitespace-pre-wrap text-foreground/80 select-text"
      >
        {text === "" ? <span className="text-foreground/35">—</span> : text}
      </p>
    </div>
  );
}

const FIELD =
  "w-full rounded-md border border-border bg-transparent px-2 py-1 text-meta text-foreground/85";

export function ComposePanel({
  styles,
  onRemove,
}: {
  readonly styles: readonly StyleEntry[];
  readonly onRemove: (styleId: string) => void;
}) {
  const [subject, setSubject] = useState("");
  const [negative, setNegative] = useState("");
  const [target, setTarget] = useState<ComposeTarget>("sd");
  const reads = COMPOSE_TARGETS.find((t) => t.id === target)?.negatives ?? true;
  const composed = composePrompt(subject, negative, styles, target);
  return (
    <div data-testid="gallery-compose" className="flex flex-col gap-3 p-3">
      <label className="flex flex-col gap-1">
        <span className="text-label text-foreground/45">Subject</span>
        <textarea
          rows={2}
          value={subject}
          placeholder="a lighthouse on a cliff"
          className={FIELD}
          onChange={(e) => setSubject(e.target.value)}
        />
      </label>
      {reads && (
        <label className="flex flex-col gap-1">
          <span className="text-label text-foreground/45">Avoid</span>
          <input value={negative} className={FIELD} onChange={(e) => setNegative(e.target.value)} />
        </label>
      )}
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Model family">
        {COMPOSE_TARGETS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={t.id === target}
            className={cn(
              "rounded-md border px-2 py-0.5 text-label",
              t.id === target
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border text-foreground/60 hover:bg-foreground/5",
            )}
            onClick={() => setTarget(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-label text-foreground/45">Styles, in facet order</span>
        {styles.length === 0 ? (
          <p className="text-label leading-snug text-foreground/40">
            Choose styles in the facets: each one adds its template to the prompt.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {styles.map((style) => (
              <button
                key={style.id}
                type="button"
                title="Remove from the prompt"
                className="rounded-md bg-primary/10 px-1.5 py-0.5 text-label text-primary hover:bg-primary/20"
                onClick={() => onRemove(style.id)}
              >
                {style.text} ×
              </button>
            ))}
          </div>
        )}
      </div>
      <Output label="Prompt" text={composed.positive} />
      {reads && <Output label="Negative prompt" text={composed.negative} />}
    </div>
  );
}
