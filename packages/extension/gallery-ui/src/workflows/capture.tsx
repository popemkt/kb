/**
 * I found something: capture, then triage (DESIGN-UI.md → The gallery).
 * A picture dropped, pasted or chosen is kept as an asset and becomes a
 * visual with no styles; a link to a picture becomes a visual that keeps
 * the link. A visual with no styles is untriaged: the inbox is that
 * reading, never stored. Triage takes one at a time, large, with a
 * type-ahead over the library's styles that gives the style to the visual
 * itself, a pin to the look, and the next.
 *
 * Keys in triage: Enter takes the top suggestion; ArrowRight, or `n` outside
 * the field, moves to the next.
 */
import { type KeyboardEvent, useEffect, useState } from "react";
import { coverOf, isTagged, GALLERY_IDS, sourceUrlOf, type WorkflowParams } from "@kb/gallery";
import { assetSrcUrl, cn, useNarrowViewport } from "@kb/ui-sdk";
import { pinToDraft, useDraft } from "../draft";
import { useComposer, type ComposerFrame } from "../frame";
import { addVisual, picturesOf, uploadPicture } from "../upload";
import { addLinkVisual, addStyleToVisual } from "./capture-api";
import { groupByFacet, linkOf, nextUntriaged, untriagedOf } from "./capture-model";
import { complete } from "./complete";
import { NoComposer } from "./no-composer";

const BUTTON =
  "rounded-md border border-border px-2 py-0.5 text-label text-foreground/70 hover:bg-foreground/5 disabled:opacity-50";
const FIELD =
  "w-full min-w-0 rounded-md border border-border bg-transparent px-2 py-1 text-meta text-foreground/85";

/** A picture's name as a visual's: its file name without the extension. */
const nameOfFile = (file: File) => file.name.replace(/\.[^.]*$/, "") || "Pasted picture";

const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA");

/** Keep pictures and links as visuals under `saveInto`; each answers its id, or null. */
function useCapture(saveInto: string | null, onCaptured: (id: string) => void) {
  const [busy, setBusy] = useState(0);
  const run = async (work: () => Promise<string | null>) => {
    setBusy((n) => n + 1);
    try {
      const id = await work();
      if (id !== null) onCaptured(id);
    } finally {
      setBusy((n) => n - 1);
    }
  };
  const files = (pictures: readonly File[]) => {
    for (const file of pictures) {
      void run(async () => {
        const picture = await uploadPicture(file);
        return picture === null ? null : addVisual(picture, nameOfFile(file), saveInto);
      });
    }
  };
  const link = (text: string, image: boolean): boolean => {
    const found = linkOf(text, image);
    if (found === null) return false;
    void run(() => addLinkVisual(found, saveInto));
    return true;
  };
  return { busy, files, link };
}

function CaptureZone({
  frame,
  onCaptured,
}: {
  readonly frame: ComposerFrame;
  readonly onCaptured: (id: string) => void;
}) {
  const { busy, files, link } = useCapture(frame.saveInto, onCaptured);
  const [url, setUrl] = useState("");
  const [over, setOver] = useState(false);
  // A paste anywhere on the page captures, unless it is typed into a field.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const pictures = picturesOf(e.clipboardData);
      if (pictures.length > 0) {
        e.preventDefault();
        files(pictures);
      } else if (!editable(e.target) && link(e.clipboardData?.getData("text/plain") ?? "", true)) {
        e.preventDefault();
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });
  const submit = () => {
    if (link(url, false)) setUrl("");
  };
  return (
    <section data-testid="gallery-capture" className="flex flex-col gap-3 p-3">
      <label
        className={cn(
          "flex min-h-32 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-4 text-center",
          over ? "border-primary bg-primary/5" : "border-border hover:bg-foreground/[0.03]",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          files(picturesOf(e.dataTransfer));
        }}
      >
        <span className="text-ui text-foreground/75">Drop or paste pictures</span>
        <span className="text-meta text-foreground/45">or tap to choose them</span>
        <input
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={(e) => {
            files([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </label>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          type="url"
          value={url}
          placeholder="https://… a link to a picture"
          aria-label="A link to a picture"
          className={FIELD}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          type="submit"
          disabled={linkOf(url, false) === null}
          className={cn(BUTTON, "shrink-0")}
        >
          Keep
        </button>
      </form>
      <p className="text-label leading-snug text-foreground/45">
        A link is kept as a link: the visual records where the picture is, and shows none until it
        is saved as a file.
      </p>
      {busy > 0 && <p className="text-label text-foreground/55">Keeping {busy}…</p>}
    </section>
  );
}

function StylePicker({
  frame,
  visual,
  onNext,
}: {
  readonly frame: ComposerFrame;
  readonly visual: string;
  readonly onNext: () => void;
}) {
  const { library } = frame;
  const [term, setTerm] = useState("");
  const own = library.stylesOf.get(visual) ?? [];
  const ranked = complete(library, term, new Set(own));
  const groups = groupByFacet(library, ranked);
  const top = groups[0]?.styles[0];
  const give = (style: string) => {
    void addStyleToVisual(visual, style);
    setTerm("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && top !== undefined) {
      e.preventDefault();
      give(top.id);
    } else if (e.key === "ArrowRight" && term === "") {
      e.preventDefault();
      onNext();
    }
  };
  return (
    <div className="flex flex-col gap-2">
      {own.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {own.map((id) => (
            <span
              key={id}
              className="rounded-md bg-primary/10 px-1.5 py-0.5 text-label text-primary"
            >
              {library.styles.get(id)?.text ?? id}
            </span>
          ))}
        </div>
      )}
      <input
        type="search"
        value={term}
        placeholder="Give it a style: type its name"
        aria-label="Give it a style"
        className={FIELD}
        onChange={(e) => setTerm(e.target.value)}
        onKeyDown={onKey}
      />
      {groups.map((group) => (
        <div key={group.facet?.id ?? ""} className="flex flex-col gap-1">
          <span className="text-label text-foreground/45">{group.facet?.text ?? "Unfiled"}</span>
          <div className="flex flex-wrap gap-1">
            {group.styles.map((style) => (
              <button
                key={style.id}
                type="button"
                className={cn(
                  "rounded-md px-1.5 py-0.5 text-label",
                  style.id === top?.id
                    ? "bg-foreground/10 text-foreground/85"
                    : "bg-foreground/5 text-foreground/65 hover:bg-foreground/10",
                )}
                onClick={() => give(style.id)}
              >
                {style.text}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TriageCard({
  frame,
  visual,
  onNext,
}: {
  readonly frame: ComposerFrame;
  readonly visual: string;
  readonly onNext: () => void;
}) {
  const draft = useDraft();
  // Next from anywhere on the page but a field, where `n` is a letter.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (editable(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight" || e.key === "n") {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const node = frame.node(visual);
  if (node === undefined) return null;
  const cover = coverOf(node);
  const source = sourceUrlOf(node);
  const pinned = draft.pins.some((p) => p.visual === visual);
  return (
    <section data-testid="gallery-triage" className="flex flex-col gap-3 p-3">
      {cover === null ? (
        <div className="flex min-h-40 items-center justify-center rounded-md border border-border bg-foreground/[0.04] text-meta text-foreground/45">
          A link only: no picture kept
        </div>
      ) : (
        <img
          src={assetSrcUrl(cover)}
          alt={node.text}
          className="max-h-[60vh] w-full rounded-md border border-border object-contain"
        />
      )}
      <div className="flex flex-col gap-0.5">
        <h2 className="text-ui font-medium break-words text-foreground/85">{node.text}</h2>
        {source !== null && (
          <a
            href={source}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-label text-foreground/50 hover:text-foreground/80"
          >
            {source}
          </a>
        )}
      </div>
      <StylePicker key={visual} frame={frame} visual={visual} onNext={onNext} />
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          disabled={pinned}
          className="rounded-md border border-primary/40 px-2 py-0.5 text-label text-primary hover:bg-primary/10 disabled:opacity-50"
          onClick={() => pinToDraft(visual)}
        >
          {pinned ? "Pinned to the look" : "Pin to the look"}
        </button>
        <button type="button" className={BUTTON} onClick={onNext}>
          Next →
        </button>
      </div>
    </section>
  );
}

/** Where to go when the inbox is empty: the other ways in. */
const ONWARD: ReadonlyArray<{ readonly id: string; readonly label: string }> = [
  { id: "browse", label: "Browse the library" },
  { id: "remix", label: "Mix what I have" },
  { id: "articulate", label: "Articulate it" },
];

function InboxEmpty({ frame }: { readonly frame: ComposerFrame }) {
  return (
    <div data-testid="gallery-inbox-empty" className="flex flex-col items-start gap-2 p-4">
      <p className="text-meta text-foreground/55">
        Nothing to triage: every visual has its styles. Capture something, or carry on another way.
      </p>
      <div className="flex flex-wrap gap-1">
        {ONWARD.map((w) => (
          <button key={w.id} type="button" className={BUTTON} onClick={() => frame.open(w.id)}>
            {w.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Capture({ frame, from }: { readonly frame: ComposerFrame; readonly from: string | null }) {
  const { library } = frame;
  const narrow = useNarrowViewport();
  const inbox = untriagedOf(library);
  const [current, setCurrent] = useState<string | null>(from);
  // The visual shown stays while it is given styles; with none chosen, the inbox's first.
  const shown =
    current !== null && frame.node(current) !== undefined ? current : (inbox[0]?.id ?? null);
  return (
    <div className={cn("flex h-full min-h-0", narrow ? "flex-col overflow-y-auto" : "")}>
      <aside
        className={cn(
          "flex shrink-0 flex-col",
          narrow ? "border-b border-border" : "w-72 border-r border-border",
        )}
      >
        <CaptureZone frame={frame} onCaptured={(id) => setCurrent((c) => c ?? id)} />
        <p className="px-3 pb-3 text-label text-foreground/45 tabular-nums">
          {inbox.length === 0 ? "The inbox is empty" : `${inbox.length} to triage`}
        </p>
      </aside>
      <main className={cn("min-w-0 flex-1", narrow ? "" : "overflow-y-auto")}>
        {shown === null ? (
          <InboxEmpty frame={frame} />
        ) : (
          <TriageCard
            frame={frame}
            visual={shown}
            onNext={() => setCurrent(nextUntriaged(library, shown))}
          />
        )}
      </main>
    </div>
  );
}

export function CaptureSurface({ params }: { readonly params: WorkflowParams }) {
  const frame = useComposer();
  if (frame === null) return <NoComposer />;
  const start = params.from === undefined ? undefined : frame.node(params.from);
  const from = start !== undefined && isTagged(start, GALLERY_IDS.visualTag) ? start.id : null;
  return <Capture frame={frame} from={from} />;
}
