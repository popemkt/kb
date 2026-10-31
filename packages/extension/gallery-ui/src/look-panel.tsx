/**
 * The look being made, beside every workflow (DESIGN-UI.md → The gallery):
 * its name, brief and what to avoid, its styles by facet, its prompt for
 * one model family (composed by the A1111 rule, `promptsOf`, never stored),
 * its palette, its pins and their notes, and what a look does: save, open
 * as a moodboard, export (`LOOK_EXPORTS`: the brief, the 3D art direction).
 *
 * While the composer's model is offered (`ComposerModelPoint`), Enhance has
 * the person's model rewrite the prompt for the family. The rewrite is an
 * editable prompt of its own, kept while the composition it was made from
 * stands, and "Use as brief" makes it the look's description. While none
 * is, Enhance says what it needs. The moodboard is offered the same way,
 * while the canvas provides a board (`MoodboardPoint`).
 */
import { type ReactNode, useRef, useState } from "react";
import {
  COMPOSE_TARGETS,
  EMPTY_LOOK,
  LOOK_EXPORTS,
  coverOf,
  exportFileName,
  nameOf,
  orderedStyles,
  promptsOf,
  type ComposeTarget,
  type LookDraft,
} from "@kb/gallery";
import { assetSrcUrl, cn, navigate, toast } from "@kb/ui-sdk";
import { copyText } from "./copy";
import { currentDraft, openLook, toggleDraftStyle, updateDraft, useDraft } from "./draft";
import type { ComposerFrame } from "./frame";
import { MODEL_NEEDS } from "./model";
import { MOODBOARD_NEEDS } from "./moodboard";
import { paletteOfPictures } from "./palette-canvas";
import { saveLook } from "./save-look";

const LINK =
  "text-label text-foreground/55 hover:text-foreground/85 disabled:opacity-40 disabled:hover:text-foreground/55";
const FIELD =
  "w-full rounded-md border border-border bg-transparent px-2 py-1 text-meta text-foreground/85";
const BUTTON =
  "rounded-md border border-border px-2 py-0.5 text-label text-foreground/70 hover:bg-foreground/5 disabled:opacity-50";

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

/** One of a few named choices, as a row of radio chips: the model family, the export. */
function Picker<T extends string>({
  label,
  options,
  value,
  onPick,
}: {
  readonly label: string;
  readonly options: ReadonlyArray<{ readonly id: T; readonly label: string }>;
  readonly value: T;
  readonly onPick: (id: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={option.id === value}
          className={cn(
            "rounded-md border px-2 py-0.5 text-label",
            option.id === value
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border text-foreground/60 hover:bg-foreground/5",
          )}
          onClick={() => onPick(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ChosenStyles({
  draft,
  frame,
}: {
  readonly draft: LookDraft;
  readonly frame: ComposerFrame;
}) {
  const { library } = frame;
  const styles = orderedStyles(library, new Set(draft.styles));
  return (
    <div className="flex flex-col gap-1">
      <span className="text-label text-foreground/45">Styles, in facet order</span>
      {styles.length === 0 ? (
        <p className="text-label leading-snug text-foreground/40">
          Choose styles in the workflow: each one adds its template to the prompt.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {styles.map((style) => (
            <button
              key={style.id}
              type="button"
              title={`${library.facets.find((f) => f.id === style.facet)?.text ?? "Unfiled"}: remove from the look`}
              data-look-style={style.text}
              className="rounded-md bg-primary/10 px-1.5 py-0.5 text-label text-primary hover:text-foreground"
              onClick={() => toggleDraftStyle(style.id)}
            >
              {style.text} ×
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
        offered
          ? "Have your agent's model rewrite the prompt for this model family"
          : `Enhance ${MODEL_NEEDS}`
      }
      className={cn(LINK, !offered && "text-foreground/35")}
      onClick={onEnhance}
    >
      {enhancing ? "Enhancing…" : "Enhance"}
    </button>
  );
}

function Prompts({ draft, frame }: { readonly draft: LookDraft; readonly frame: ComposerFrame }) {
  const [target, setTarget] = useState<ComposeTarget>("sd");
  const [enhanced, setEnhanced] = useState<Enhanced | null>(null);
  // The composition a rewrite is being asked for; only the latest ask's answer lands.
  const [asking, setAsking] = useState<Composed | null>(null);
  const latest = useRef(0);
  const { model } = frame;
  const composed = promptsOf(draft, frame.library).find((p) => p.target === target);
  const positive = composed?.positive ?? "";
  const reads = COMPOSE_TARGETS.find((t) => t.id === target)?.negatives ?? true;
  // A rewrite stands for the composition it was made from, and goes with it.
  const rewrite = isOf(enhanced, positive, target) ? enhanced : null;
  const enhancing = isOf(asking, positive, target);
  const enhance = () => {
    if (model === null) return toast(`Enhance ${MODEL_NEEDS}`);
    const from = positive;
    const ask = (latest.current += 1);
    setAsking({ from, target });
    void model.enhance(from, target).then((text) => {
      if (ask !== latest.current) return;
      if (text !== null) setEnhanced({ from, target, text });
      setAsking(null);
    });
  };
  return (
    <>
      <Picker label="Model family" options={COMPOSE_TARGETS} value={target} onPick={setTarget} />
      <Output label="Prompt" text={positive}>
        <EnhanceButton
          offered={model !== null}
          disabled={positive === "" || enhancing}
          enhancing={enhancing}
          onEnhance={enhance}
        />
      </Output>
      {rewrite !== null && (
        <div className="flex flex-col gap-1">
          <Head label="Enhanced prompt" text={rewrite.text}>
            <button
              type="button"
              className={LINK}
              title="Make the rewrite the look's brief"
              onClick={() => updateDraft((d) => ({ ...d, description: rewrite.text }))}
            >
              Use as brief
            </button>
          </Head>
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
      {reads && <Output label="Negative prompt" text={composed?.negative ?? ""} />}
    </>
  );
}

function Palette({ draft, frame }: { readonly draft: LookDraft; readonly frame: ComposerFrame }) {
  const [busy, setBusy] = useState(false);
  const covers = draft.pins.flatMap((pin) => {
    const visual = frame.node(pin.visual);
    const cover = visual === undefined ? null : coverOf(visual);
    return cover === null ? [] : [cover];
  });
  const take = () => {
    setBusy(true);
    void paletteOfPictures(covers).then((palette) => {
      setBusy(false);
      if (palette.length === 0) return toast("No colours could be read from the pins");
      updateDraft((d) => ({ ...d, palette: [...palette] }));
    });
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-label text-foreground/45">Palette</span>
        <button
          type="button"
          disabled={covers.length === 0 || busy}
          className={LINK}
          onClick={take}
        >
          {busy ? "Reading…" : "Take from the pins"}
        </button>
      </div>
      {draft.palette.length === 0 ? (
        <p className="text-label text-foreground/40">Pin references, then take their colours.</p>
      ) : (
        <div className="flex flex-wrap gap-1" data-testid="look-palette">
          {draft.palette.map((hex) => (
            <button
              key={hex}
              type="button"
              title={`${hex}: copy`}
              aria-label={hex}
              className="size-7 rounded-md border border-border"
              style={{ background: hex }}
              onClick={() => copyText(hex, "Colour")}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const note = (visual: string, text: string) =>
  updateDraft((d) => ({
    ...d,
    pins: d.pins.map((p) => (p.visual === visual ? { ...p, note: text } : p)),
  }));
const unpin = (visual: string) =>
  updateDraft((d) => ({ ...d, pins: d.pins.filter((p) => p.visual !== visual) }));

function Pins({ draft, frame }: { readonly draft: LookDraft; readonly frame: ComposerFrame }) {
  if (draft.pins.length === 0) {
    return (
      <p className="text-label text-foreground/40">
        No pins yet: pin the references this look takes something from.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-testid="look-pins">
      <span className="text-label text-foreground/45">Pins</span>
      {draft.pins.map((pin) => {
        const visual = frame.node(pin.visual);
        const cover = visual === undefined ? null : coverOf(visual);
        return (
          <div key={pin.visual} className="flex items-center gap-2">
            {cover === null ? (
              <div className="size-12 shrink-0 rounded-md bg-foreground/5" />
            ) : (
              <img
                src={assetSrcUrl(cover)}
                alt={visual?.text ?? ""}
                className="size-12 shrink-0 rounded-md object-cover"
              />
            )}
            <input
              value={pin.note}
              placeholder="What it is here for: the lighting, the palette…"
              aria-label={`Note on ${visual?.text ?? "the pin"}`}
              className={FIELD}
              onChange={(e) => note(pin.visual, e.target.value)}
            />
            <button
              type="button"
              className={LINK}
              aria-label="Unpin"
              onClick={() => unpin(pin.visual)}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

function download(file: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = file;
  a.click();
  URL.revokeObjectURL(url);
}

function LookActions({
  draft,
  frame,
}: {
  readonly draft: LookDraft;
  readonly frame: ComposerFrame;
}) {
  const [saving, setSaving] = useState(false);
  const { board } = frame;
  const save = async (): Promise<string | null> => {
    setSaving(true);
    const id = await saveLook(frame.saveInto, frame.node);
    setSaving(false);
    return id;
  };
  const moodboard = async () => {
    if (board === null) return toast(MOODBOARD_NEEDS);
    const look = await save();
    if (look === null) return;
    // The pins as just saved: each card shows the pin's node, so its note is the card's text.
    const cards = currentDraft().pins.flatMap((pin) => {
      const visual = frame.node(pin.visual);
      const cover = visual === undefined ? null : coverOf(visual);
      return pin.id === null
        ? []
        : [{ node: pin.id, ...(cover === null ? {} : { picture: cover }) }];
    });
    const reply = await board.pin(look, `${nameOf(draft)} — moodboard`, cards);
    if (!reply.ok) return toast(`Could not open the moodboard: ${reply.reason}`);
    navigate(reply.path);
  };
  return (
    <div className="flex flex-wrap gap-1">
      <button
        type="button"
        data-testid="look-save"
        disabled={saving}
        className={BUTTON}
        onClick={() => void save()}
      >
        {saving ? "Saving…" : draft.id === null ? "Save look" : "Save changes"}
      </button>
      <button
        type="button"
        aria-disabled={board === null}
        title={board === null ? MOODBOARD_NEEDS : "Open the look's pins on a canvas"}
        className={cn(BUTTON, board === null && "text-foreground/35")}
        onClick={() => void moodboard()}
      >
        Moodboard
      </button>
      <button
        type="button"
        className={BUTTON}
        title="Start a new look; the saved one stays"
        onClick={() => openLook(EMPTY_LOOK, frame.node)}
      >
        New
      </button>
    </div>
  );
}

/**
 * What the look exports to (`LOOK_EXPORTS`): the brief for a person, or the
 * 3D art direction a builder follows; copied, downloaded, or read here.
 */
function Exports({ draft, frame }: { readonly draft: LookDraft; readonly frame: ComposerFrame }) {
  const [chosen, setChosen] = useState(LOOK_EXPORTS[0]?.id ?? "");
  const target = LOOK_EXPORTS.find((t) => t.id === chosen) ?? LOOK_EXPORTS[0];
  if (target === undefined) return null;
  const text = target.render(draft, frame.library, frame.node);
  return (
    <div className="flex flex-col gap-1" data-testid="gallery-exports">
      <Head label={`Export: ${target.label}`} text={text}>
        <button
          type="button"
          className={LINK}
          onClick={() => download(exportFileName(nameOf(draft), target), text)}
        >
          Download .md
        </button>
      </Head>
      <Picker label="Export" options={LOOK_EXPORTS} value={target.id} onPick={setChosen} />
      <details className="group">
        <summary className="cursor-pointer text-label text-foreground/45 hover:text-foreground/70">
          Preview
        </summary>
        <pre
          data-gallery-export={target.id}
          className="mt-1 max-h-72 overflow-auto rounded-md border border-border bg-foreground/[0.03] px-2 py-1.5 text-meta break-words whitespace-pre-wrap text-foreground/80 select-text"
        >
          {text}
        </pre>
      </details>
    </div>
  );
}

function Brief({ draft, frame }: { readonly draft: LookDraft; readonly frame: ComposerFrame }) {
  const forNode = draft.forNode === null ? undefined : frame.node(draft.forNode);
  return (
    <>
      <input
        value={draft.name}
        placeholder={nameOf(draft)}
        aria-label="Look name"
        className={cn(FIELD, "text-ui font-medium")}
        onChange={(e) => updateDraft((d) => ({ ...d, name: e.target.value }))}
      />
      {forNode !== undefined && (
        <p className="text-label text-foreground/55">
          For <span className="text-foreground/80">{forNode.text}</span>{" "}
          <button
            type="button"
            className={LINK}
            onClick={() => updateDraft((d) => ({ ...d, forNode: null }))}
          >
            ×
          </button>
        </p>
      )}
      <label className="flex flex-col gap-1">
        <span className="text-label text-foreground/45">Brief</span>
        <textarea
          rows={3}
          value={draft.description}
          placeholder="a lighthouse on a cliff at dusk, lonely, wind"
          aria-label="Brief"
          className={FIELD}
          onChange={(e) => updateDraft((d) => ({ ...d, description: e.target.value }))}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-label text-foreground/45">Avoid</span>
        <input
          value={draft.negative}
          aria-label="Avoid"
          className={FIELD}
          onChange={(e) => updateDraft((d) => ({ ...d, negative: e.target.value }))}
        />
      </label>
    </>
  );
}

export function LookPanel({ frame }: { readonly frame: ComposerFrame }) {
  const draft = useDraft();
  return (
    <div data-testid="gallery-look" className="flex flex-col gap-3 p-3">
      <Brief draft={draft} frame={frame} />
      <ChosenStyles draft={draft} frame={frame} />
      <Prompts draft={draft} frame={frame} />
      <Palette draft={draft} frame={frame} />
      <Pins draft={draft} frame={frame} />
      <Exports draft={draft} frame={frame} />
      <LookActions draft={draft} frame={frame} />
    </div>
  );
}
