/**
 * I have a picture: start from one visual (`from`), picked from the
 * library or dropped in. Then:
 *
 * - **What is this called?** Its styles, each a chip that adds it to the
 *   look; and, while a model that sees is offered, the model's reading of
 *   the picture, axis by axis, in the library's words.
 * - **More like this:** the visuals that share most of its styles (image
 *   similarity is a recorded gap; shared styles stand in).
 * - **Variations:** its look along one axis, one style swapped for a
 *   sibling of its facet, each a whole look to take.
 */
import { useDeferredValue, useMemo, useState } from "react";
import {
  coverOf,
  filterVisuals,
  moreLike,
  variationsOf,
  type GraphNode,
  type WorkflowParams,
} from "@kb/gallery";
import { assetSrcUrl, cn, toast } from "@kb/ui-sdk";
import { addDraftStyles, pinToDraft, toggleDraftStyle, updateDraft, useDraft } from "../draft";
import { useComposer, type ComposerFrame } from "../frame";
import { MasonryGrid } from "../masonry-grid";
import { MODEL_NEEDS, type Reflected } from "../model";
import { addVisual, picturesOf, uploadPicture } from "../upload";
import { Axes } from "./articulate-parts";
import { NoComposer } from "./no-composer";

const HEADING = "text-label font-medium tracking-wide text-foreground/50 uppercase";
const BUTTON =
  "rounded-md border border-border px-2 py-0.5 text-label text-foreground/70 hover:bg-foreground/5 disabled:opacity-50";

function Pick({ frame }: { readonly frame: ComposerFrame }) {
  const [text, setText] = useState("");
  const deferred = useDeferredValue(text);
  const shown = useMemo(
    () => filterVisuals(frame.library, new Map(), deferred),
    [frame.library, deferred],
  );
  const drop = (files: readonly File[]) => {
    const file = files[0];
    if (file === undefined) return;
    void uploadPicture(file).then(async (kept) => {
      if (kept === null) return;
      const id = await addVisual(kept, file.name.replace(/\.\w+$/, ""), frame.saveInto);
      if (id !== null) frame.open("reference", id);
    });
  };
  return (
    <div
      data-testid="gallery-reference-pick"
      className="flex h-full min-h-0 flex-col gap-2 p-3"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        drop(picturesOf(e.dataTransfer));
      }}
      onPaste={(e) => drop(picturesOf(e.clipboardData))}
    >
      <h2 className={HEADING}>Pick a picture, or drop one here</h2>
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={text}
          placeholder="Search titles and prompts"
          aria-label="Search the library"
          className="w-72 min-w-0 rounded-md border border-border bg-transparent px-2 py-1 text-meta text-foreground/85"
          onChange={(e) => setText(e.target.value)}
        />
        <label className={cn(BUTTON, "cursor-pointer")}>
          Upload
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => drop([...(e.target.files ?? [])])}
          />
        </label>
      </div>
      <div className="min-h-0 flex-1">
        <MasonryGrid
          key={deferred}
          visuals={shown}
          selectedId={null}
          onOpen={(id) => frame.open("reference", id)}
        />
      </div>
    </div>
  );
}

function Called({ frame, visual }: { readonly frame: ComposerFrame; readonly visual: GraphNode }) {
  const draft = useDraft();
  const [reflected, setReflected] = useState<Reflected | null>(null);
  const [busy, setBusy] = useState(false);
  const own = frame.library.stylesOf.get(visual.id) ?? [];
  const cover = coverOf(visual);
  const ask = async () => {
    if (frame.model === null) return toast(`Reading the picture ${MODEL_NEEDS}`);
    if (cover === null) return toast("This visual has no picture to read");
    setBusy(true);
    const answer = await frame.model
      .reflect(visual.text, [cover], frame.library)
      .finally(() => setBusy(false));
    if (answer === null) return;
    if (answer.refused !== undefined)
      toast(`Your model refused the picture (${answer.refused}): it read only the title`);
    else if (answer.saw === 0) toast("Your model cannot see pictures: it read only the title");
    setReflected(answer);
  };
  return (
    <section aria-label="What is this called" className="flex flex-col gap-2">
      <h2 className={HEADING}>What is this called?</h2>
      {own.length === 0 ? (
        <p className="text-label text-foreground/45">The library files it under no style yet.</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {own.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={draft.styles.includes(id)}
              className={cn(
                "rounded-md px-1.5 py-0.5 text-meta",
                draft.styles.includes(id)
                  ? "bg-primary/10 text-primary"
                  : "bg-foreground/5 text-foreground/70 hover:text-foreground",
              )}
              onClick={() => toggleDraftStyle(id)}
            >
              {frame.library.styles.get(id)?.text ?? id}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={BUTTON}
          disabled={own.length === 0}
          onClick={() => addDraftStyles(own)}
        >
          Take all its styles
        </button>
        <button
          type="button"
          className={BUTTON}
          disabled={draft.pins.some((p) => p.visual === visual.id)}
          onClick={() => pinToDraft(visual.id)}
        >
          Pin to the look
        </button>
        <button
          type="button"
          disabled={busy}
          aria-disabled={frame.model === null}
          title={
            frame.model === null
              ? `Reading the picture ${MODEL_NEEDS}`
              : "Have your model name what it sees"
          }
          className={cn(BUTTON, frame.model === null && "text-foreground/35")}
          onClick={() => void ask()}
        >
          {busy ? "Reading…" : "Ask your model"}
        </button>
      </div>
      {reflected !== null && (
        <>
          {reflected.reflection.description !== "" && (
            <p className="text-meta text-foreground/70">{reflected.reflection.description}</p>
          )}
          <Axes frame={frame} reflection={reflected.reflection} />
        </>
      )}
    </section>
  );
}

function Kin({ frame, visual }: { readonly frame: ComposerFrame; readonly visual: GraphNode }) {
  const like = useMemo(() => moreLike(frame.library, visual.id, 12), [frame.library, visual.id]);
  const variations = useMemo(
    () => variationsOf(frame.library, frame.library.stylesOf.get(visual.id) ?? [], 3),
    [frame.library, visual.id],
  );
  return (
    <>
      <section aria-label="More like this" className="flex flex-col gap-2">
        <h2 className={HEADING}>More like this</h2>
        {like.length === 0 ? (
          <p className="text-label text-foreground/45">Nothing else shares its styles yet.</p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-2">
            {like.map((id) => {
              const node = frame.node(id);
              const cover = node === undefined ? null : coverOf(node);
              return (
                <button
                  key={id}
                  type="button"
                  title={node?.text}
                  className="shrink-0"
                  onClick={() => frame.open("reference", id)}
                >
                  {cover === null ? (
                    <span className="block size-24 rounded-md bg-foreground/5" />
                  ) : (
                    <img
                      src={assetSrcUrl(cover)}
                      alt={node?.text ?? ""}
                      className="size-24 rounded-md object-cover"
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </section>
      {variations.length > 0 && (
        <section aria-label="Variations" className="flex flex-col gap-2">
          <h2 className={HEADING}>Vary one axis</h2>
          <div className="flex flex-wrap gap-1">
            {variations.map((v) => (
              <button
                key={`${v.from.id}>${v.to.id}`}
                type="button"
                title="Make this the look's styles"
                className={BUTTON}
                onClick={() => {
                  updateDraft((d) => ({ ...d, styles: [...v.styles] }));
                  pinToDraft(visual.id, `varied: ${v.to.text} for ${v.from.text}`);
                }}
              >
                {v.from.text} → <span className="text-foreground/90">{v.to.text}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function Reference({
  frame,
  visual,
}: {
  readonly frame: ComposerFrame;
  readonly visual: GraphNode;
}) {
  const cover = coverOf(visual);
  return (
    <div
      data-testid="gallery-reference"
      className="flex h-full flex-col gap-5 overflow-y-auto p-4 md:flex-row"
    >
      <div className="flex shrink-0 flex-col gap-2 md:w-2/5">
        {cover !== null && (
          <img
            src={assetSrcUrl(cover)}
            alt={visual.text}
            className="max-h-[60vh] w-full rounded-md border border-border object-contain"
          />
        )}
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-ui font-medium text-foreground/85">{visual.text}</h1>
          <button type="button" className={BUTTON} onClick={() => frame.open("reference")}>
            Another
          </button>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <Called frame={frame} visual={visual} />
        <Kin frame={frame} visual={visual} />
      </div>
    </div>
  );
}

export function ReferenceSurface({ params }: { readonly params: WorkflowParams }) {
  const frame = useComposer();
  if (frame === null) return <NoComposer />;
  const visual = params.from === undefined ? undefined : frame.node(params.from);
  return visual === undefined ? (
    <Pick frame={frame} />
  ) : (
    <Reference key={visual.id} frame={frame} visual={visual} />
  );
}
