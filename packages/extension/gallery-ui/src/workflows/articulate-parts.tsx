/**
 * The parts of "Help me articulate it": the axes an idea is broken into,
 * each with its chips drawn with an example picture (the library as a
 * visual dictionary); the reference strip a person reacts to instead of
 * naming; and the either/or cards. Every reaction changes the look, so
 * the chips and what is offered next follow it.
 */
import { useMemo, useState } from "react";
import {
  axesOf,
  axisStyles,
  chipsFor,
  eitherOrs,
  examplesOf,
  nearest,
  type Axis,
  type Chip,
  type Reflection,
} from "@kb/gallery";
import { cn } from "@kb/ui-sdk";
import { addDraftStyles, pinToDraft, toggleDraftStyle, updateDraft, useDraft } from "../draft";
import type { ComposerFrame } from "../frame";
import { addStyle } from "../styles-api";
import { Thumb } from "../thumb";

const SECTION = "flex flex-col gap-2";
const HEADING = "text-label font-medium tracking-wide text-foreground/50 uppercase";

function ChipButton({
  frame,
  chip,
  example,
  chosen,
}: {
  readonly frame: ComposerFrame;
  readonly chip: Chip;
  readonly example: string | undefined;
  readonly chosen: boolean;
}) {
  const pick = () => {
    if (chip.style !== null) return toggleDraftStyle(chip.style);
    // A word the library has not got: a style of the axis's facet, or, with none, part of the brief.
    if (chip.facet !== null) return void addStyle(chip.text, chip.facet);
    updateDraft((d) => ({
      ...d,
      description: [d.description.trim(), chip.text].filter(Boolean).join(", "),
    }));
  };
  return (
    <button
      type="button"
      aria-pressed={chosen}
      data-gallery-chip={chip.text}
      title={chip.style === null ? "New to the library: add it" : undefined}
      className={cn(
        "flex min-h-9 items-center gap-1.5 rounded-md border py-0.5 pr-2 pl-2 text-meta has-[img]:pl-0.5",
        chosen
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border text-foreground/70 hover:bg-foreground/5",
        chip.style === null && "border-dashed",
      )}
      onClick={pick}
    >
      <Thumb frame={frame} visual={example} />
      {chip.text}
      {chip.style === null && <span className="text-label text-foreground/40">+</span>}
    </button>
  );
}

function AxisRow({
  frame,
  axis,
  terms,
  examples,
}: {
  readonly frame: ComposerFrame;
  readonly axis: Axis;
  readonly terms: readonly string[] | undefined;
  readonly examples: ReadonlyMap<string, string>;
}) {
  const draft = useDraft();
  const [all, setAll] = useState(false);
  const offered = axisStyles(frame.library, axis);
  const suggested = terms === undefined ? [] : chipsFor(frame.library, axis, terms);
  const shown: readonly Chip[] =
    all || terms === undefined
      ? [
          ...suggested,
          ...offered
            .filter((s) => !suggested.some((c) => c.style === s.id))
            .map((s) => ({ text: s.text, style: s.id, facet: s.facet })),
        ]
      : suggested;
  if (shown.length === 0 && offered.length === 0) return null;
  return (
    <div data-gallery-axis={axis.id} className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-meta text-foreground/80">{axis.label}</span>
        {terms !== undefined && offered.length > 0 && (
          <button
            type="button"
            className="text-label text-foreground/45 hover:text-foreground/75"
            onClick={() => setAll((a) => !a)}
          >
            {all ? "fewer" : `all ${offered.length}`}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {shown.map((chip) => (
          <ChipButton
            key={chip.text}
            frame={frame}
            chip={chip}
            example={chip.style === null ? undefined : examples.get(chip.style)}
            chosen={chip.style !== null && draft.styles.includes(chip.style)}
          />
        ))}
      </div>
    </div>
  );
}

/** The axes, with the reflection's terms where there is one, or every style of each to pick by hand. */
export function Axes({
  frame,
  reflection,
}: {
  readonly frame: ComposerFrame;
  readonly reflection: Reflection | null;
}) {
  const examples = useMemo(() => examplesOf(frame.library), [frame.library]);
  const axes = axesOf(frame.library);
  return (
    <section className={SECTION} aria-label="Axes">
      <h2 className={HEADING}>Name it, axis by axis</h2>
      {axes.map((axis) => (
        <AxisRow
          key={axis.id}
          frame={frame}
          axis={axis}
          terms={reflection === null ? undefined : (reflection.axes.get(axis.id) ?? [])}
          examples={examples}
        />
      ))}
    </section>
  );
}

function ReactCard({
  frame,
  visual,
  onNo,
}: {
  readonly frame: ComposerFrame;
  readonly visual: string;
  readonly onNo: () => void;
}) {
  const node = frame.node(visual);
  const own = frame.library.stylesOf.get(visual) ?? [];
  const axes = axesOf(frame.library).filter((axis) =>
    own.some((s) => axis.facets.includes(frame.library.styles.get(s)?.facet ?? "")),
  );
  const take = (axisId: string) => {
    const axis = axes.find((a) => a.id === axisId);
    if (axis === undefined) return;
    addDraftStyles(
      own.filter((s) => axis.facets.includes(frame.library.styles.get(s)?.facet ?? "")),
    );
    pinToDraft(visual, `the ${axis.label.toLowerCase()} from here`);
  };
  return (
    <figure data-gallery-react={visual} className="flex w-36 shrink-0 flex-col gap-1">
      <Thumb frame={frame} visual={visual} size="h-36 w-36" />
      <figcaption className="truncate text-label text-foreground/60">
        {node?.text ?? visual}
      </figcaption>
      <div className="flex gap-1">
        <button
          type="button"
          title="More like this: pin it and take its styles"
          className="flex-1 rounded-md border border-border py-0.5 text-label text-foreground/75 hover:bg-primary/10"
          onClick={() => {
            addDraftStyles(own);
            pinToDraft(visual);
          }}
        >
          Like
        </button>
        <button
          type="button"
          title="Not this: offer less like it"
          className="flex-1 rounded-md border border-border py-0.5 text-label text-foreground/55 hover:bg-foreground/5"
          onClick={onNo}
        >
          Not this
        </button>
      </div>
      {axes.length > 0 && (
        <select
          value=""
          aria-label={`Take one axis from ${node?.text ?? "it"}`}
          className="rounded-md border border-border bg-transparent px-1 py-0.5 text-label text-foreground/60"
          onChange={(e) => take(e.target.value)}
        >
          <option value="">Take only its…</option>
          {axes.map((axis) => (
            <option key={axis.id} value={axis.id}>
              {axis.label.toLowerCase()}
            </option>
          ))}
        </select>
      )}
    </figure>
  );
}

/** References to react to, nearest the look first; a "not this" moves what comes next. */
export function ReactStrip({ frame }: { readonly frame: ComposerFrame }) {
  const draft = useDraft();
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const against = useMemo(() => {
    const no = new Set<string>();
    for (const id of dismissed) for (const s of frame.library.stylesOf.get(id) ?? []) no.add(s);
    for (const s of draft.styles) no.delete(s);
    return no;
  }, [dismissed, frame.library, draft.styles]);
  const pinned = new Set(draft.pins.map((p) => p.visual));
  const offered = nearest(frame.library, draft.styles, against, 80)
    .filter((id) => !dismissed.has(id) && !pinned.has(id))
    .slice(0, 12);
  return (
    <section className={SECTION} aria-label="React">
      <h2 className={HEADING}>React to references</h2>
      {offered.length === 0 ? (
        <p className="text-label text-foreground/45">
          Nothing left to offer from the library: find more online, or save some through Capture.
        </p>
      ) : (
        <div data-testid="gallery-react" className="flex gap-3 overflow-x-auto pb-2">
          {offered.map((id) => (
            <ReactCard
              key={id}
              frame={frame}
              visual={id}
              onNo={() => setDismissed((d) => new Set([...d, id]))}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** Either/or: two styles of an axis the look has nothing in, each with its example. */
export function EitherOr({ frame }: { readonly frame: ComposerFrame }) {
  const draft = useDraft();
  const [round, setRound] = useState(0);
  const examples = useMemo(() => examplesOf(frame.library), [frame.library]);
  const cards = eitherOrs(frame.library, new Set(draft.styles), round);
  if (cards.length === 0) return null;
  return (
    <section className={SECTION} aria-label="Either or">
      <div className="flex items-center gap-3">
        <h2 className={HEADING}>This or that?</h2>
        <button
          type="button"
          className="text-label text-foreground/45 hover:text-foreground/75"
          onClick={() => setRound((r) => r + 1)}
        >
          Other pairs
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {cards.map(({ axis, pair }) => (
          <div
            key={axis.id}
            data-gallery-either={axis.id}
            className="flex flex-wrap items-center gap-2"
          >
            <span className="w-28 shrink-0 text-meta text-foreground/60">{axis.label}</span>
            {pair.map((style, i) => (
              <span key={style.id} className="flex items-center gap-2">
                {i === 1 && <span className="text-label text-foreground/35">or</span>}
                <button
                  type="button"
                  className="flex min-h-9 items-center gap-1.5 rounded-md border border-border py-0.5 pr-2 pl-2 text-meta text-foreground/75 hover:bg-primary/10 has-[img]:pl-0.5"
                  onClick={() => toggleDraftStyle(style.id)}
                >
                  <Thumb frame={frame} visual={examples.get(style.id)} />
                  {style.text}
                </button>
              </span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
