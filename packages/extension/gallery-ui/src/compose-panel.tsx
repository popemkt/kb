/**
 * The composer: a subject, the chosen styles applied in facet order by the
 * A1111 rule (`composePrompt`), for one model family. The chosen styles are
 * the facet selection itself, so what the grid shows is what the prompt
 * asks for.
 *
 * Where the server serves the agent's completion (`ext.agent.complete`),
 * Enhance has the person's model rewrite the composed prompt for the family
 * (`enhancePrompt`). The rewrite is an editable prompt of its own, kept
 * while the composition it was made from stands.
 */
import { type ReactNode, useState } from "react";
import {
  COMPOSE_TARGETS,
  composePrompt,
  ENHANCE_ACTION,
  type ComposeTarget,
  type StyleEntry,
} from "@kb/gallery";
import { cn, useServes } from "@kb/ui-sdk";
import { copyText } from "./copy";
import { enhancePrompt } from "./gallery-api";

const LINK =
  "text-label text-foreground/55 hover:text-foreground/85 disabled:opacity-40 disabled:hover:text-foreground/55";

function Head({
  label,
  text,
  children,
}: {
  readonly label: string;
  readonly text: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-label text-foreground/45">{label}</span>
      <div className="flex items-center gap-3">
        {children}
        <button
          type="button"
          disabled={text === ""}
          className={LINK}
          onClick={() => copyText(text, label)}
        >
          Copy
        </button>
      </div>
    </div>
  );
}

function Output({
  label,
  text,
  children,
}: {
  readonly label: string;
  readonly text: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Head label={label} text={text}>
        {children}
      </Head>
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

/** A rewrite of one composition: the prompt and family it was made from, and its text as edited. */
interface Enhanced {
  readonly from: string;
  readonly target: ComposeTarget;
  readonly text: string;
}

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
  const [enhanced, setEnhanced] = useState<Enhanced | null>(null);
  const [enhancing, setEnhancing] = useState(false);
  const canEnhance = useServes(ENHANCE_ACTION);
  const reads = COMPOSE_TARGETS.find((t) => t.id === target)?.negatives ?? true;
  const composed = composePrompt(subject, negative, styles, target);
  // A rewrite stands for the composition it was made from, and goes with it.
  const rewrite =
    enhanced !== null && enhanced.from === composed.positive && enhanced.target === target
      ? enhanced
      : null;
  const enhance = () => {
    const from = composed.positive;
    setEnhancing(true);
    void enhancePrompt(from, target).then((text) => {
      if (text !== null) setEnhanced({ from, target, text });
      setEnhancing(false);
    });
  };
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
                className="rounded-md bg-primary/10 px-1.5 py-0.5 text-label text-primary hover:line-through"
                onClick={() => onRemove(style.id)}
              >
                {style.text} ×
              </button>
            ))}
          </div>
        )}
      </div>
      <Output label="Prompt" text={composed.positive}>
        {canEnhance && (
          <button
            type="button"
            data-testid="gallery-enhance"
            disabled={composed.positive === "" || enhancing}
            title="Have your agent's model rewrite the prompt for this model family"
            className={LINK}
            onClick={enhance}
          >
            {enhancing ? "Enhancing…" : "Enhance"}
          </button>
        )}
      </Output>
      {rewrite !== null && (
        <div className="flex flex-col gap-1">
          <Head label="Enhanced prompt" text={rewrite.text} />
          <textarea
            data-gallery-output="Enhanced prompt"
            aria-label="Enhanced prompt"
            rows={5}
            value={rewrite.text}
            className={FIELD}
            onChange={(e) => setEnhanced({ ...rewrite, text: e.target.value })}
          />
        </div>
      )}
      {reads && <Output label="Negative prompt" text={composed.negative} />}
    </div>
  );
}
