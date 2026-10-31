/**
 * Help me articulate it (docs/research/2026-10-30-visual-composer.md §2):
 * for the person with a feeling or a fragment rather than the words.
 *
 * 1. **Start from anything:** their own words, and pictures dropped or
 *    pasted (a screenshot too), kept as assets; a link pasted is kept as
 *    words.
 * 2. **Reflect:** the person's model breaks it into axes (subject, mood,
 *    lighting, camera and lens, palette, era or style, artists,
 *    composition, motion) with candidate terms, each drawn with an
 *    example picture. A model that cannot see is sent the words alone, and
 *    the page says so; with no model at all, every axis offers its styles
 *    to pick by hand.
 * 3. **React instead of naming:** references nearest the look to like,
 *    refuse, or take one axis from, and either/or cards.
 *
 * What is chosen goes into the look beside it.
 */
import { useState } from "react";
import type { WorkflowParams } from "@kb/gallery";
import { assetSrcUrl, toast } from "@kb/ui-sdk";
import { pinToDraft, updateDraft, useDraft } from "../draft";
import { useComposer, type ComposerFrame } from "../frame";
import { MODEL_NEEDS, type Reflected } from "../model";
import { SourcesPanel } from "../sources-panel";
import { picturesOf, uploadPicture } from "../upload";
import { Axes, EitherOr, ReactStrip } from "./articulate-parts";
import { NoComposer } from "./no-composer";

const HEADING = "text-label font-medium tracking-wide text-foreground/50 uppercase";

function StartBox({
  words,
  onWords,
  pictures,
  onPictures,
}: {
  readonly words: string;
  readonly onWords: (words: string) => void;
  readonly pictures: readonly string[];
  readonly onPictures: (change: (before: readonly string[]) => readonly string[]) => void;
}) {
  const [over, setOver] = useState(false);
  const keep = (files: readonly File[]) => {
    for (const file of files) {
      void uploadPicture(file).then((kept) => {
        if (kept !== null) onPictures((before) => [...before, kept.path]);
      });
    }
  };
  return (
    <section aria-label="Start from anything" className="flex flex-col gap-2">
      <h2 className={HEADING}>Start from anything</h2>
      <textarea
        rows={4}
        value={words}
        aria-label="Describe it"
        placeholder="Say it in your own words: a feeling, a scene, a film it reminds you of… Drop or paste pictures here too."
        className={`w-full rounded-md border bg-transparent px-3 py-2 text-ui text-foreground/85 ${over ? "border-primary/60" : "border-border"}`}
        onChange={(e) => onWords(e.target.value)}
        onPaste={(e) => {
          const files = picturesOf(e.clipboardData);
          if (files.length === 0) return;
          e.preventDefault();
          keep(files);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          keep(picturesOf(e.dataTransfer));
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        {pictures.map((path) => (
          <span key={path} className="relative">
            <img src={assetSrcUrl(path)} alt="" className="size-16 rounded-md object-cover" />
            <button
              type="button"
              aria-label="Remove the picture"
              className="absolute -top-1 -right-1 rounded-full bg-background px-1 text-label text-foreground/60"
              onClick={() => onPictures((before) => before.filter((p) => p !== path))}
            >
              ×
            </button>
          </span>
        ))}
        <label className="cursor-pointer rounded-md border border-dashed border-border px-2 py-1 text-label text-foreground/55 hover:bg-foreground/5">
          Add pictures
          <input
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={(e) => keep([...(e.target.files ?? [])])}
          />
        </label>
      </div>
    </section>
  );
}

/** What the page says about the pictures after a reflection. */
function sawText(reflected: Reflected): string | null {
  const { sent } = reflected;
  if (sent === 0) return null;
  if (reflected.refused !== undefined)
    return `Your model refused the pictures (${reflected.refused}), so it read the words only.`;
  if (reflected.saw === 0)
    return "Your model read the words only: it cannot see pictures, so they were not sent.";
  return `Your model saw ${reflected.saw} of the ${sent} ${sent === 1 ? "picture" : "pictures"}.`;
}

function Reflect({
  frame,
  words,
  pictures,
  onReflected,
}: {
  readonly frame: ComposerFrame;
  readonly words: string;
  readonly pictures: readonly string[];
  readonly onReflected: (reflected: Reflected) => void;
}) {
  const [busy, setBusy] = useState(false);
  const empty = words.trim() === "" && pictures.length === 0;
  const reflect = async () => {
    if (frame.model === null) return toast(`Reflect ${MODEL_NEEDS}`);
    setBusy(true);
    const reflected = await frame.model
      .reflect(words, pictures, frame.library)
      .finally(() => setBusy(false));
    if (reflected === null) return;
    const brief = reflected.reflection.description.trim();
    if (brief !== "")
      updateDraft((d) => (d.description.trim() === "" ? { ...d, description: brief } : d));
    onReflected(reflected);
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        data-testid="gallery-reflect"
        disabled={busy || empty}
        aria-disabled={frame.model === null}
        title={
          frame.model === null ? `Reflect ${MODEL_NEEDS}` : "Have your model break it into axes"
        }
        className="rounded-md border border-primary/40 px-3 py-1 text-meta text-primary hover:bg-primary/10 disabled:opacity-50"
        onClick={() => void reflect()}
      >
        {busy ? "Reflecting…" : "Reflect"}
      </button>
      {frame.model === null && (
        <span className="text-label text-foreground/45">
          Reflect {MODEL_NEEDS}. Until then, name it by hand below.
        </span>
      )}
    </div>
  );
}

function Articulate({ frame }: { readonly frame: ComposerFrame }) {
  const draft = useDraft();
  const [words, setWords] = useState(draft.description);
  const [pictures, setPictures] = useState<readonly string[]>([]);
  const [reflected, setReflected] = useState<Reflected | null>(null);
  const [online, setOnline] = useState(false);
  const said = reflected === null ? null : sawText(reflected);
  return (
    <div
      data-testid="gallery-articulate"
      className="flex h-full flex-col gap-5 overflow-y-auto p-4"
    >
      <StartBox
        words={words}
        onWords={setWords}
        pictures={pictures}
        onPictures={(change) => setPictures(change)}
      />
      <Reflect frame={frame} words={words} pictures={pictures} onReflected={setReflected} />
      {said !== null && (
        <p data-testid="gallery-saw" className="text-label text-foreground/55">
          {said}
        </p>
      )}
      <Axes frame={frame} reflection={reflected?.reflection ?? null} />
      <EitherOr frame={frame} />
      <ReactStrip frame={frame} />
      <div className="flex flex-col gap-2">
        <button
          type="button"
          aria-expanded={online}
          className="self-start text-label text-foreground/55 hover:text-foreground/85"
          onClick={() => setOnline((o) => !o)}
        >
          {online ? "Hide the online sources" : "Find references online"}
        </button>
        {online && (
          <SourcesPanel
            sources={frame.sources}
            suggested={[draft.description, words].find((w) => w.trim() !== "")?.trim() ?? ""}
            onSaved={(id) => pinToDraft(id)}
          />
        )}
      </div>
    </div>
  );
}

export function ArticulateSurface(_props: { readonly params: WorkflowParams }) {
  const frame = useComposer();
  return frame === null ? <NoComposer /> : <Articulate frame={frame} />;
}
