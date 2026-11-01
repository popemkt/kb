/**
 * Set up a scene (DESIGN-UI.md → The gallery): a studio dock. The scene is
 * the look being made, nothing beside it: its description is the field the
 * scene is described in, and its styles and pins fill the parts of the shot.
 *
 * - **The field.** The look's description. `#` in it completes a style
 *   from the library, as Compose completes a term, and takes it.
 * - **The parts.** One card per axis of the library (`axesOf`: camera,
 *   lighting, style, motion, …), each showing what fills it with its
 *   example picture, or "Auto" while nothing does: an empty part is left to
 *   the model, as an empty facet always is. References is the look's pins.
 * - **One picker.** A part opens its facets as tabs and their styles as
 *   picture cards, and stays open across picks. Its first tile names a new
 *   style under the tab's facet (`addStyle`, Compose's gesture). References
 *   offers the library's visuals, those most like the pinned ones first.
 * - **The board.** What the scene has so far, as pictures, above the dock.
 *
 * Its prompt, palette and exports (the 3D art direction among them) are the
 * look panel's, beside it, as for every workflow.
 */
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  axisStyles,
  examplesOf,
  moreLike,
  orderedStyles,
  type Axis,
  type StyleEntry,
  type WorkflowParams,
} from "@kb/gallery";
import { cn } from "@kb/ui-sdk";
import { pinToDraft, toggleDraftStyle, updateDraft, useDraft } from "../draft";
import { useComposer, type ComposerFrame } from "../frame";
import { addStyle } from "../styles-api";
import { Thumb } from "../thumb";
import { complete } from "./complete";
import { NoComposer } from "./no-composer";
import { filling, hashTermAt, partsOf, referenceOrder } from "./scene-model";

/** The part the look's pins fill: not an axis, since no facet holds a picture. */
const REFERENCES = "references";

const CARD =
  "flex w-36 shrink-0 flex-col items-start gap-1 rounded-lg border p-2 text-left hover:bg-foreground/5";

function SceneField({ frame }: { readonly frame: ComposerFrame }) {
  const draft = useDraft();
  const field = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const typing = hashTermAt(draft.description, caret);
  const hits = typing === null ? [] : complete(frame.library, typing.term, new Set(draft.styles));
  const take = (style: StyleEntry) => {
    if (typing === null) return;
    const text = draft.description;
    const next = `${text.slice(0, typing.at)}${text.slice(caret)}`.replace(/ {2,}/g, " ");
    updateDraft((d) => ({ ...d, description: next }));
    toggleDraftStyle(style.id);
    setCaret(typing.at);
    setActive(0);
    field.current?.focus();
  };
  const facetText = (s: StyleEntry) =>
    frame.library.facets.find((f) => f.id === s.facet)?.text ?? "";
  return (
    <div className="flex flex-col gap-1 p-2">
      <textarea
        ref={field}
        value={draft.description}
        rows={2}
        aria-label="The scene"
        placeholder="Describe the scene: who or what, where, when. Type # to take a style."
        className="w-full resize-none rounded-md bg-transparent px-2 py-1 text-ui text-foreground/85 outline-none"
        onChange={(e) => {
          updateDraft((d) => ({ ...d, description: e.target.value }));
          setCaret(e.target.selectionStart);
          setActive(0);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          if (hits.length === 0) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const step = e.key === "ArrowDown" ? 1 : -1;
            setActive((i) => (i + step + hits.length) % hits.length);
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            const style = hits[active] ?? hits[0];
            if (style !== undefined) take(style);
          }
        }}
      />
      {typing !== null && typing.term.trim() !== "" && (
        <div role="listbox" aria-label="Styles" className="flex flex-wrap gap-1 px-1">
          {hits.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="option"
              aria-selected={i === active}
              data-gallery-suggestion={s.text}
              className={cn(
                "rounded-md border px-2 py-0.5 text-meta",
                i === active
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border text-foreground/70",
              )}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => take(s)}
            >
              {s.text} <span className="text-label text-foreground/40">{facetText(s)}</span>
            </button>
          ))}
          {hits.length === 0 && (
            <span className="text-label text-foreground/50">
              Not in the library: name it as a new style in one of the parts below.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function PartCard({
  frame,
  axis,
  examples,
  onOpen,
}: {
  readonly frame: ComposerFrame;
  readonly axis: Axis;
  readonly examples: ReadonlyMap<string, string>;
  readonly onOpen: () => void;
}) {
  const draft = useDraft();
  const filled = filling(frame.library, axis, draft.styles);
  const first = filled[0];
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      data-gallery-part={axis.label}
      title={filled.length === 0 ? "Auto: left to the model" : undefined}
      className={cn(CARD, filled.length > 0 ? "border-primary/40" : "border-border")}
      onClick={onOpen}
    >
      <span className="text-label text-foreground/45">{axis.label}</span>
      <span className="flex min-h-12 items-center gap-2">
        {first !== undefined && (
          <Thumb frame={frame} visual={examples.get(first.id)} size="size-12" />
        )}
        <span
          className={cn(
            "line-clamp-2 text-meta",
            filled.length > 0 ? "text-foreground/85" : "text-foreground/40",
          )}
        >
          {filled.length === 0 ? "Auto" : filled.map((s) => s.text).join(", ")}
        </span>
      </span>
    </button>
  );
}

function ReferencesCard({
  frame,
  onOpen,
}: {
  readonly frame: ComposerFrame;
  readonly onOpen: () => void;
}) {
  const draft = useDraft();
  const pins = draft.pins.length;
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      data-gallery-part="References"
      className={cn(CARD, pins > 0 ? "border-primary/40" : "border-border")}
      onClick={onOpen}
    >
      <span className="text-label text-foreground/45">References</span>
      <span className="flex min-h-12 items-center gap-2">
        {draft.pins[0] !== undefined && (
          <Thumb frame={frame} visual={draft.pins[0].visual} size="size-12" />
        )}
        <span className={cn("text-meta", pins > 0 ? "text-foreground/85" : "text-foreground/40")}>
          {pins === 0 ? "None" : `${pins} pinned`}
        </span>
      </span>
    </button>
  );
}

/** The sheet a part opens in: over the scene, closed by Done, Escape or a click outside. */
function Sheet({
  label,
  count,
  onClose,
  children,
}: {
  readonly label: string;
  readonly count: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="absolute inset-0 z-10 bg-background/60" onClick={onClose} aria-hidden />
      <section
        role="dialog"
        aria-label={`Choose ${label}`}
        className="absolute inset-2 z-20 flex min-h-0 flex-col rounded-lg border border-border bg-popover shadow-lifted"
      >
        <header className="flex items-center gap-3 border-b border-border px-3 py-2">
          <strong className="text-ui font-medium text-foreground/85">{label}</strong>
          <span className="text-label text-foreground/45">{count}</span>
          <div className="flex-1" />
          <button
            type="button"
            className="rounded-md border border-border px-2 py-0.5 text-label text-foreground/70 hover:bg-foreground/5"
            onClick={onClose}
          >
            Done
          </button>
        </header>
        {children}
      </section>
    </>
  );
}

/** The first tile of a part's picker: a new style, named here, under the facet shown. */
function NewStyleTile({
  facet,
  facetText,
}: {
  readonly facet: string;
  readonly facetText: string;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  if (!naming)
    return (
      <button
        type="button"
        data-gallery-new-style
        title="A new style under this facet: it joins the library like any other"
        className="flex min-h-40 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-meta text-foreground/55 hover:bg-foreground/5"
        onClick={() => setNaming(true)}
      >
        <span className="text-title">+</span>
        New style
        <span className="text-label text-foreground/40">{facetText}</span>
      </button>
    );
  const add = () => {
    if (name.trim() === "") return setNaming(false);
    void addStyle(name.trim(), facet).then(() => {
      setName("");
      setNaming(false);
    });
  };
  return (
    <div className="flex min-h-40 flex-col justify-center gap-2 rounded-lg border border-primary/40 p-2">
      <input
        autoFocus
        value={name}
        aria-label={`A new style under ${facetText}`}
        placeholder={`Name it (${facetText})`}
        className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-meta text-foreground/85"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") add();
          if (e.key === "Escape") {
            e.stopPropagation();
            setNaming(false);
          }
        }}
      />
      <button type="button" className="text-label text-primary" onClick={add}>
        Add to the library and the scene
      </button>
    </div>
  );
}

function StyleCard({
  frame,
  style,
  facetText,
  example,
}: {
  readonly frame: ComposerFrame;
  readonly style: StyleEntry;
  readonly facetText: string;
  readonly example: string | undefined;
}) {
  const draft = useDraft();
  const chosen = draft.styles.includes(style.id);
  return (
    <button
      type="button"
      aria-pressed={chosen}
      data-gallery-style={style.text}
      title={style.description === "" ? undefined : style.description}
      className={cn(
        "flex flex-col items-start gap-1 rounded-lg border p-1.5 text-left hover:bg-foreground/5",
        chosen ? "border-primary/60 bg-primary/10" : "border-border",
      )}
      onClick={() => toggleDraftStyle(style.id)}
    >
      <span className="flex h-28 w-full items-center justify-center overflow-hidden rounded-md bg-foreground/5">
        {example === undefined ? (
          <span className="px-2 text-center text-label text-foreground/35">No picture yet</span>
        ) : (
          <Thumb frame={frame} visual={example} size="h-28 w-full" />
        )}
      </span>
      <span className="text-label text-foreground/40">{facetText}</span>
      <span className={cn("text-meta", chosen ? "text-primary" : "text-foreground/85")}>
        {style.text}
      </span>
      {style.description !== "" && (
        <span className="line-clamp-2 text-label text-foreground/50">{style.description}</span>
      )}
    </button>
  );
}

const ALL = "";

function PartPicker({
  frame,
  axis,
  examples,
  onClose,
}: {
  readonly frame: ComposerFrame;
  readonly axis: Axis;
  readonly examples: ReadonlyMap<string, string>;
  readonly onClose: () => void;
}) {
  const draft = useDraft();
  const [tab, setTab] = useState(ALL);
  const [term, setTerm] = useState("");
  const facets = frame.library.facets.filter((f) => axis.facets.includes(f.id));
  const facetText = (id: string | null) => facets.find((f) => f.id === id)?.text ?? "";
  const needle = term.trim().toLowerCase();
  const shown = axisStyles(frame.library, axis).filter(
    (s) =>
      (tab === ALL || s.facet === tab) &&
      (needle === "" ||
        s.text.toLowerCase().includes(needle) ||
        s.description.toLowerCase().includes(needle)),
  );
  const newUnder = tab === ALL ? (facets[0]?.id ?? "") : tab;
  return (
    <Sheet
      label={axis.label}
      count={`${filling(frame.library, axis, draft.styles).length} chosen`}
      onClose={onClose}
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2">
        {[{ id: ALL, text: "All" }, ...facets].map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={tab === f.id}
            className={cn(
              "rounded-md px-2 py-0.5 text-meta",
              tab === f.id
                ? "bg-foreground/10 text-foreground/85"
                : "text-foreground/55 hover:text-foreground/80",
            )}
            onClick={() => setTab(f.id)}
          >
            {f.text}
          </button>
        ))}
        <input
          value={term}
          aria-label={`Search ${axis.label}`}
          placeholder="Search…"
          className="ml-auto w-48 rounded-md border border-border bg-transparent px-2 py-0.5 text-meta text-foreground/85"
          onChange={(e) => setTerm(e.target.value)}
        />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-2 overflow-y-auto p-3 sm:grid-cols-3 lg:grid-cols-5">
        {newUnder !== "" && <NewStyleTile facet={newUnder} facetText={facetText(newUnder)} />}
        {shown.map((style) => (
          <StyleCard
            key={style.id}
            frame={frame}
            style={style}
            facetText={facetText(style.facet)}
            example={examples.get(style.id)}
          />
        ))}
      </div>
    </Sheet>
  );
}

function ReferencesPicker({
  frame,
  onClose,
}: {
  readonly frame: ComposerFrame;
  readonly onClose: () => void;
}) {
  const draft = useDraft();
  const pinned = useMemo(() => draft.pins.map((p) => p.visual), [draft.pins]);
  const order = useMemo(() => referenceOrder(frame.library, pinned), [frame.library, pinned]);
  const like = new Set(pinned.flatMap((id) => moreLike(frame.library, id)));
  const toggle = (id: string) => {
    if (!pinned.includes(id)) return pinToDraft(id);
    updateDraft((d) => ({ ...d, pins: d.pins.filter((p) => p.visual !== id) }));
  };
  return (
    <Sheet
      label="References"
      count={`${pinned.length} pinned · the most like them first`}
      onClose={onClose}
    >
      <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-2 overflow-y-auto p-3 sm:grid-cols-3 lg:grid-cols-5">
        {order.map((id) => {
          const visual = frame.node(id);
          if (visual === undefined) return null;
          const on = pinned.includes(id);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              data-gallery-reference={visual.text}
              className={cn(
                "flex flex-col items-start gap-1 rounded-lg border p-1.5 text-left hover:bg-foreground/5",
                on ? "border-primary/60 bg-primary/10" : "border-border",
              )}
              onClick={() => toggle(id)}
            >
              <span className="flex h-28 w-full items-center justify-center overflow-hidden rounded-md bg-foreground/5">
                <Thumb frame={frame} visual={id} size="h-28 w-full" />
              </span>
              <span className="line-clamp-2 text-meta text-foreground/80">{visual.text}</span>
              {!on && like.has(id) && (
                <span className="text-label text-primary">More like this</span>
              )}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

/** What the scene has so far, as pictures: its styles' examples and its pins. */
function Board({
  frame,
  examples,
}: {
  readonly frame: ComposerFrame;
  readonly examples: ReadonlyMap<string, string>;
}) {
  const draft = useDraft();
  const styles = orderedStyles(frame.library, new Set(draft.styles));
  if (styles.length === 0 && draft.pins.length === 0)
    return (
      <p className="flex min-h-24 flex-1 items-center justify-center rounded-lg border border-dashed border-border p-6 text-center text-meta text-foreground/45">
        Describe the scene, then fill its parts below. A part left on Auto is the model&apos;s to
        choose.
      </p>
    );
  const tile = "flex w-32 shrink-0 flex-col gap-1";
  return (
    <div
      aria-label="The scene so far"
      className="flex min-h-0 flex-1 content-start gap-2 overflow-x-auto pb-1"
    >
      {draft.pins.map((pin) => (
        <figure key={pin.visual} className={tile}>
          <Thumb frame={frame} visual={pin.visual} size="h-32 w-32" />
          <figcaption className="line-clamp-1 text-label text-foreground/55">
            {frame.node(pin.visual)?.text ?? ""} · reference
          </figcaption>
        </figure>
      ))}
      {styles.map((style) => (
        <figure key={style.id} className={tile}>
          {examples.get(style.id) === undefined ? (
            <span className="flex h-32 w-32 items-center justify-center rounded-md bg-foreground/5 px-2 text-center text-label text-foreground/40">
              {style.text}
            </span>
          ) : (
            <Thumb frame={frame} visual={examples.get(style.id)} size="h-32 w-32" />
          )}
          <figcaption className="line-clamp-1 text-label text-foreground/55">
            {style.text}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function Scene({ frame }: { readonly frame: ComposerFrame }) {
  const parts = useMemo(() => partsOf(frame.library), [frame.library]);
  const examples = useMemo(() => examplesOf(frame.library), [frame.library]);
  const [open, setOpen] = useState<string | null>(null);
  const close = () => setOpen(null);
  const part = parts.find((axis) => axis.id === open);
  return (
    <div data-testid="gallery-scene" className="relative flex h-full min-h-0 flex-col gap-3 p-3">
      <Board frame={frame} examples={examples} />
      <div className="shrink-0 rounded-lg border border-border bg-foreground/[0.02]">
        <SceneField frame={frame} />
        <div
          role="group"
          aria-label="The parts of the scene"
          className="flex gap-2 overflow-x-auto border-t border-border p-2"
        >
          <ReferencesCard frame={frame} onOpen={() => setOpen(REFERENCES)} />
          {parts.map((axis) => (
            <PartCard
              key={axis.id}
              frame={frame}
              axis={axis}
              examples={examples}
              onOpen={() => setOpen(axis.id)}
            />
          ))}
        </div>
      </div>
      {open === REFERENCES && <ReferencesPicker frame={frame} onClose={close} />}
      {part !== undefined && (
        <PartPicker frame={frame} axis={part} examples={examples} onClose={close} />
      )}
    </div>
  );
}

export function SceneSurface(_props: { readonly params: WorkflowParams }) {
  const frame = useComposer();
  return frame === null ? <NoComposer /> : <Scene frame={frame} />;
}
