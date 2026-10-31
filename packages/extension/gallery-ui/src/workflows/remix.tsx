/**
 * Mix what I have (DESIGN-UI.md → The gallery): "the lighting of A, the
 * palette of B". Two or three sources, visuals and saved looks, are laid out
 * one axis at a time with each source's styles on it, and a choice per axis
 * of whose to take; "Make the look" makes the draft's styles the union of
 * those taken and pins the visual sources, each noting what was taken from
 * it. Varying one look along one axis is the same move with one source: its
 * variations, grouped by the style swapped, each made the draft's styles
 * with a click. It reads only styles the library already has.
 */
import { useMemo, useState } from "react";
import {
  GALLERY_IDS,
  coverOf,
  isTagged,
  lookOf,
  looksOf,
  nameOf,
  type GraphNode,
  type WorkflowParams,
} from "@kb/gallery";
import { assetSrcUrl, cn, useNodes } from "@kb/ui-sdk";
import { updateDraft, useDraft } from "../draft";
import { useComposer, type ComposerFrame } from "../frame";
import { Tabs } from "../tabs";
import { NoComposer } from "./no-composer";
import {
  defaultChoices,
  remixDraft,
  remixRows,
  variationGroups,
  type RemixChoices,
  type RemixSource,
} from "./remix-model";

const BUTTON =
  "rounded-md border border-border px-2 py-0.5 text-label text-foreground/70 hover:bg-foreground/5 disabled:opacity-50";
const FIELD =
  "w-full min-w-0 rounded-md border border-border bg-transparent px-2 py-1 text-meta text-foreground/85";
const HEADING = "text-label text-foreground/45";

/** At most this many sources mix; the table stays readable on a phone. */
const MAX_SOURCES = 3;
/** The visuals the picker draws at once; the search narrows the rest. */
const SHOWN_VISUALS = 60;

/** A visual or a saved look as a source; null for any other node. */
function sourceOf(frame: ComposerFrame, node: GraphNode): RemixSource | null {
  if (isTagged(node, GALLERY_IDS.lookTag)) {
    const look = lookOf(node, frame.node);
    return { id: node.id, kind: "look", label: nameOf(look), styles: look.styles };
  }
  if (isTagged(node, GALLERY_IDS.visualTag)) {
    const styles = frame.library.stylesOf.get(node.id) ?? [];
    return { id: node.id, kind: "visual", label: node.text, styles };
  }
  return null;
}

function SourcePicker({
  frame,
  looks,
  chosen,
  onToggle,
}: {
  readonly frame: ComposerFrame;
  readonly looks: readonly GraphNode[];
  readonly chosen: readonly string[];
  readonly onToggle: (node: GraphNode) => void;
}) {
  const [text, setText] = useState("");
  const needle = text.trim().toLowerCase();
  const visuals = frame.library.visuals
    .filter((v) => needle === "" || v.text.toLowerCase().includes(needle))
    .slice(0, SHOWN_VISUALS);
  const full = chosen.length >= MAX_SOURCES;
  const chip = (node: GraphNode, label: string) => (
    <button
      key={node.id}
      type="button"
      aria-pressed={chosen.includes(node.id)}
      disabled={full && !chosen.includes(node.id)}
      className={cn(
        "rounded-md border px-2 py-0.5 text-label disabled:opacity-40",
        chosen.includes(node.id)
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border text-foreground/65 hover:bg-foreground/5",
      )}
      onClick={() => onToggle(node)}
    >
      {label}
    </button>
  );
  return (
    <section className="flex flex-col gap-2">
      <span className={HEADING}>
        Choose two or three sources ({chosen.length} of {MAX_SOURCES})
      </span>
      <p className="text-label text-foreground/50">
        Then take each axis from the one you choose: the lighting of one, the palette of another.
        Looks and visuals both count.
      </p>
      {looks.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {looks.map((look) => chip(look, `Look: ${nameOf(lookOf(look, frame.node))}`))}
        </div>
      )}
      <input
        type="search"
        value={text}
        placeholder="Search visuals"
        aria-label="Search visuals"
        className={FIELD}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {visuals.map((visual) => (
          <CoverTile
            key={visual.id}
            visual={visual}
            chosen={chosen.includes(visual.id)}
            disabled={full && !chosen.includes(visual.id)}
            onPick={() => onToggle(visual)}
          />
        ))}
      </div>
    </section>
  );
}

function CoverTile({
  visual,
  chosen,
  disabled,
  onPick,
}: {
  readonly visual: GraphNode;
  readonly chosen: boolean;
  readonly disabled: boolean;
  readonly onPick: () => void;
}) {
  const cover = coverOf(visual);
  return (
    <button
      type="button"
      aria-pressed={chosen}
      disabled={disabled}
      title={visual.text}
      className="flex min-w-0 flex-col text-left disabled:opacity-40"
      onClick={onPick}
    >
      <span
        className={cn(
          "block aspect-square overflow-hidden rounded-md border bg-foreground/[0.04]",
          chosen
            ? "border-primary ring-1 ring-primary"
            : "border-border hover:border-foreground/30",
        )}
      >
        {cover === null ? (
          <span className="flex h-full items-center justify-center text-label text-foreground/35">
            No image
          </span>
        ) : (
          <img
            src={assetSrcUrl(cover)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        )}
      </span>
      <span className="truncate pt-0.5 text-label text-foreground/60">{visual.text}</span>
    </button>
  );
}

function AxisRow({
  label,
  sources,
  cells,
  choice,
  onChoose,
}: {
  readonly label: string;
  readonly sources: readonly RemixSource[];
  readonly cells: ReadonlyArray<ReadonlyArray<{ readonly id: string; readonly text: string }>>;
  readonly choice: number | undefined;
  readonly onChoose: (index: number | undefined) => void;
}) {
  const option = (index: number | undefined, title: string, styles: readonly string[]) => (
    <label
      key={index ?? "none"}
      className={cn(
        "flex min-w-0 flex-1 cursor-pointer items-start gap-2 rounded-md border px-2 py-1",
        choice === index ? "border-primary/40 bg-primary/5" : "border-border",
      )}
    >
      <input
        type="radio"
        name={`remix-${label}`}
        checked={choice === index}
        className="mt-0.5"
        onChange={() => onChoose(index)}
      />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-label text-foreground/55">{title}</span>
        <span className="text-meta break-words text-foreground/80">
          {styles.length === 0 ? "—" : styles.join(", ")}
        </span>
      </span>
    </label>
  );
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="pb-1 text-meta font-medium text-foreground/75">{label}</legend>
      <div className="flex flex-col gap-1 sm:flex-row">
        {sources.map((source, i) =>
          option(
            i,
            source.label,
            (cells[i] ?? []).map((s) => s.text),
          ),
        )}
        {option(undefined, "None", [])}
      </div>
    </fieldset>
  );
}

function MixTable({
  frame,
  sources,
}: {
  readonly frame: ComposerFrame;
  readonly sources: readonly RemixSource[];
}) {
  const rows = useMemo(() => remixRows(frame.library, sources), [frame.library, sources]);
  const [choices, setChoices] = useState<RemixChoices>(() => defaultChoices(rows));
  if (rows.length === 0) {
    return (
      <p className="text-meta text-foreground/45">
        These sources have no styles yet: give them styles in Capture or Browse to mix them.
      </p>
    );
  }
  const choose = (axis: string, index: number | undefined) =>
    setChoices((before) => {
      const next = new Map(before);
      if (index === undefined) next.delete(axis);
      else next.set(axis, index);
      return next;
    });
  return (
    <section data-testid="gallery-remix-table" className="flex flex-col gap-3">
      <span className={HEADING}>Take each axis from</span>
      {rows.map((row) => (
        <AxisRow
          key={row.axis.id}
          label={row.axis.label}
          sources={sources}
          cells={row.cells}
          choice={choices.get(row.axis.id)}
          onChoose={(index) => choose(row.axis.id, index)}
        />
      ))}
      <div>
        <button
          type="button"
          className="rounded-md border border-primary/40 px-2 py-0.5 text-label text-primary hover:bg-primary/10"
          onClick={() => updateDraft((d) => remixDraft(d, sources, rows, choices))}
        >
          Make the look
        </button>
      </div>
    </section>
  );
}

function Mix({
  frame,
  looks,
  from,
}: {
  readonly frame: ComposerFrame;
  readonly looks: readonly GraphNode[];
  readonly from: string | null;
}) {
  const [chosen, setChosen] = useState<readonly string[]>(from === null ? [] : [from]);
  const sources = useMemo(
    () =>
      chosen.flatMap((id) => {
        const node = frame.node(id);
        const source = node === undefined ? null : sourceOf(frame, node);
        return source === null ? [] : [source];
      }),
    [chosen, frame],
  );
  const toggle = (node: GraphNode) =>
    setChosen((c) =>
      c.includes(node.id)
        ? c.filter((id) => id !== node.id)
        : c.length < MAX_SOURCES
          ? [...c, node.id]
          : c,
    );
  return (
    <div className="flex flex-col gap-4">
      <SourcePicker frame={frame} looks={looks} chosen={chosen} onToggle={toggle} />
      {sources.length >= 2 ? (
        <MixTable key={chosen.join("|")} frame={frame} sources={sources} />
      ) : (
        <p className="text-meta text-foreground/45">Choose at least two sources to mix.</p>
      )}
    </div>
  );
}

/** The draft being made, as the source a variation starts from. */
const DRAFT_SOURCE = "";

function Vary({
  frame,
  looks,
  from,
}: {
  readonly frame: ComposerFrame;
  readonly looks: readonly GraphNode[];
  readonly from: string | null;
}) {
  const draft = useDraft();
  const [base, setBase] = useState(
    from !== null && looks.some((l) => l.id === from) ? from : DRAFT_SOURCE,
  );
  const look = base === DRAFT_SOURCE ? undefined : frame.node(base);
  const styles = look === undefined ? draft.styles : lookOf(look, frame.node).styles;
  const groups = variationGroups(frame.library, styles);
  return (
    <section data-testid="gallery-vary" className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className={HEADING}>Vary</span>
        <select value={base} className={FIELD} onChange={(e) => setBase(e.target.value)}>
          <option value={DRAFT_SOURCE}>The look being made</option>
          {looks.map((l) => (
            <option key={l.id} value={l.id}>
              {nameOf(lookOf(l, frame.node))}
            </option>
          ))}
        </select>
      </label>
      {groups.length === 0 && (
        <p className="text-meta text-foreground/45">
          Nothing to vary: choose styles that sit under a facet with siblings.
        </p>
      )}
      {groups.map((group) => (
        <div key={group.from.id} className="flex flex-col gap-1">
          <span className={HEADING}>Instead of {group.from.text}</span>
          <div className="flex flex-wrap gap-1">
            {group.options.map((option) => (
              <button
                key={option.to.id}
                type="button"
                title="Make these the look's styles"
                className={BUTTON}
                onClick={() => updateDraft((d) => ({ ...d, styles: option.styles }))}
              >
                {option.to.text}
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

type Mode = "mix" | "vary";

const MODES: ReadonlyArray<{ readonly id: Mode; readonly label: string }> = [
  { id: "mix", label: "Mix sources" },
  { id: "vary", label: "Vary one axis" },
];

function Remix({ frame, from }: { readonly frame: ComposerFrame; readonly from: string | null }) {
  const nodes = useNodes();
  const looks = useMemo(() => looksOf(nodes.values()), [nodes]);
  const [mode, setMode] = useState<Mode>("mix");
  return (
    <div data-testid="gallery-remix" className="flex h-full min-h-0 flex-col">
      <Tabs label="Remix" tabs={MODES} shown={mode} onPick={setMode} />
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {mode === "mix" ? (
          <Mix frame={frame} looks={looks} from={from} />
        ) : (
          <Vary frame={frame} looks={looks} from={from} />
        )}
      </div>
    </div>
  );
}

export function RemixSurface({ params }: { readonly params: WorkflowParams }) {
  const frame = useComposer();
  if (frame === null) return <NoComposer />;
  const start = params.from === undefined ? undefined : frame.node(params.from);
  const from = start !== undefined && sourceOf(frame, start) !== null ? start.id : null;
  return <Remix frame={frame} from={from} />;
}
