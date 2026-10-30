/**
 * The composer: a subject, the chosen styles applied in facet order by the
 * A1111 rule (`composePrompt`), for one model family. The chosen styles are
 * the facet selection itself, so what the grid shows is what the prompt
 * asks for.
 *
 * While a model's completion is provided (`PromptEnhancerPoint`), Enhance
 * has the person's model rewrite the composed prompt for the family. The
 * rewrite is an editable prompt of its own, kept while the composition it
 * was made from stands. While none is, Enhance says what it needs.
 */
import { type ReactNode, useRef, useState } from "react";
import { COMPOSE_TARGETS, composePrompt, type ComposeTarget, type StyleEntry } from "@kb/gallery";
import { cn, toast, useContributions } from "@kb/ui-sdk";
import { copyText } from "./copy";
import { ENHANCE_NEEDS, PromptEnhancerPoint } from "./enhance";

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

/** One composition: the prompt and the family it is for. */
interface Composed {
  readonly from: string;
  readonly target: ComposeTarget;
}

/** A rewrite of one composition, and its text as edited. */
interface Enhanced extends Composed {
  readonly text: string;
}

const isOf = (made: Composed | null, from: string, target: ComposeTarget) =>
  made !== null && made.from === from && made.target === target;

function FamilyPicker({
  target,
  onPick,
}: {
  readonly target: ComposeTarget;
  readonly onPick: (target: ComposeTarget) => void;
}) {
  return (
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
          onClick={() => onPick(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function ChosenStyles({
  styles,
  onRemove,
}: {
  readonly styles: readonly StyleEntry[];
  readonly onRemove: (styleId: string) => void;
}) {
  return (
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
  );
}

function EnhanceButton({
  offered,
  disabled,
  enhancing,
  onEnhance,
}: {
  readonly offered: boolean;
  readonly disabled: boolean;
  readonly enhancing: boolean;
  readonly onEnhance: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="gallery-enhance"
      disabled={disabled}
      aria-disabled={!offered}
      title={
        offered ? "Have your agent's model rewrite the prompt for this model family" : ENHANCE_NEEDS
      }
      className={cn(LINK, !offered && "text-foreground/35")}
      onClick={onEnhance}
    >
      {enhancing ? "Enhancing…" : "Enhance"}
    </button>
  );
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
  // The composition a rewrite is being asked for; only the latest ask's answer lands.
  const [asking, setAsking] = useState<Composed | null>(null);
  const latest = useRef(0);
  const enhancer = useContributions(PromptEnhancerPoint)[0]?.value ?? null;
  const reads = COMPOSE_TARGETS.find((t) => t.id === target)?.negatives ?? true;
  const composed = composePrompt(subject, negative, styles, target);
  // A rewrite stands for the composition it was made from, and goes with it;
  // so does an ask, so another composition may be enhanced at once.
  const rewrite = isOf(enhanced, composed.positive, target) ? enhanced : null;
  const enhancing = isOf(asking, composed.positive, target);
  const enhance = () => {
    if (enhancer === null) {
      toast(ENHANCE_NEEDS);
      return;
    }
    const from = composed.positive;
    const ask = (latest.current += 1);
    setAsking({ from, target });
    void enhancer.enhance(from, target).then((text) => {
      if (ask !== latest.current) return;
      if (text !== null) setEnhanced({ from, target, text });
      setAsking(null);
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
      <FamilyPicker target={target} onPick={setTarget} />
      <ChosenStyles styles={styles} onRemove={onRemove} />
      <Output label="Prompt" text={composed.positive}>
        <EnhanceButton
          offered={enhancer !== null}
          disabled={composed.positive === "" || enhancing}
          enhancing={enhancing}
          onEnhance={enhance}
        />
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
