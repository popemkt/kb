/**
 * Backdrop Studio's framing bar and interactions panel (DESIGN-UI.md →
 * Backdrop Studio → Framing; → Interact): the preview the scene is drawn
 * as, its zoom and pan, the switch into Interact; and what the backdrop
 * answers (`Backdrop.interactions`), each a cue a person can try.
 */
import { useState } from "react";
import {
  ArrowCounterClockwiseIcon,
  HandPointingIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
} from "@phosphor-icons/react";
import {
  BACKDROP_CUE_LABELS,
  type BackdropCue,
  type BackdropInteraction,
} from "@kb/appearance-kit";
import { ASPECTS, MAX_ZOOM, MIN_ZOOM, type AspectId, type Preview } from "./framing";
import type { StudioActivity } from "./interact";
import { Segments, ToolButton } from "./segments";
import type { Framing } from "./use-framing";

const PREVIEWS: readonly { readonly id: Preview["kind"]; readonly label: string }[] = [
  { id: "head", label: "Page head" },
  { id: "page", label: "Full page" },
  { id: "aspect", label: "Aspect" },
];

export function FramingBar({
  framing,
  interacting,
  onInteract,
}: {
  readonly framing: Framing;
  readonly interacting: boolean;
  readonly onInteract: (on: boolean) => void;
}) {
  const { preview, zoom, scale, pannable } = framing;
  // The proportions an aspect preview last had, so switching back to it keeps them.
  const [aspect, setAspect] = useState<AspectId>("16:9");
  const showAspect = (next: AspectId) => {
    setAspect(next);
    framing.choose({ kind: "aspect", aspect: next });
  };
  return (
    <div
      className="relative z-10 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-foreground/[0.06] px-4 py-1"
      data-studio-framing=""
    >
      <Segments
        label="Preview size"
        options={PREVIEWS}
        value={preview.kind}
        onChange={(kind) => (kind === "aspect" ? showAspect(aspect) : framing.choose({ kind }))}
      />
      {preview.kind === "aspect" ? (
        <Segments label="Aspect" options={ASPECTS} value={preview.aspect} onChange={showAspect} />
      ) : null}
      <div className="flex items-center gap-0.5" role="group" aria-label="Zoom">
        <ToolButton label="Zoom out" disabled={scale <= MIN_ZOOM} onClick={framing.zoomOut}>
          <MagnifyingGlassMinusIcon size={13} aria-hidden="true" />
        </ToolButton>
        <span
          className="w-11 text-center text-label tabular-nums text-foreground/55"
          data-studio-zoom-label=""
        >
          {Math.round(scale * 100)}%
        </span>
        <ToolButton label="Zoom in" disabled={scale >= MAX_ZOOM} onClick={framing.zoomIn}>
          <MagnifyingGlassPlusIcon size={13} aria-hidden="true" />
        </ToolButton>
        <ToolButton label="Fit the whole scene" pressed={zoom === "fit"} onClick={framing.fit}>
          Fit
        </ToolButton>
        <ToolButton label="Its own size, 1:1" pressed={zoom === 1} onClick={framing.actual}>
          1:1
        </ToolButton>
        <ToolButton label="Reset the view" onClick={framing.reset}>
          <ArrowCounterClockwiseIcon size={13} aria-hidden="true" />
        </ToolButton>
      </div>
      {pannable && !interacting ? (
        <span className="text-label text-foreground/40">Drag to pan</span>
      ) : null}
      <span className="flex-1" />
      <ToolButton
        label={interacting ? "Stop interacting" : "Interact with the scene"}
        pressed={interacting}
        onClick={() => onInteract(!interacting)}
      >
        <HandPointingIcon size={13} aria-hidden="true" />
        Interact
      </ToolButton>
    </div>
  );
}

/** The cues in the order people read them (`BACKDROP_CUE_LABELS`). */
const CUE_ORDER: readonly string[] = Object.keys(BACKDROP_CUE_LABELS);

const byCue = (a: BackdropInteraction, b: BackdropInteraction) =>
  CUE_ORDER.indexOf(a.cue) - CUE_ORDER.indexOf(b.cue);

export function InteractionsPanel({
  interactions,
  interacting,
  owner,
}: {
  readonly interactions: readonly BackdropInteraction[];
  readonly interacting: boolean;
  /** The owner the studio acts out, whose cues the panel tries. */
  readonly owner: StudioActivity;
}) {
  const listed = interactions.toSorted(byCue);
  return (
    <section
      aria-label="Interactions"
      className="pointer-events-auto flex w-80 max-w-full flex-col gap-2 rounded-lg border border-foreground/10 bg-popover/85 p-3 text-meta shadow-floating backdrop-blur-md"
      data-studio-interactions=""
      data-studio-panel=""
    >
      <h2 className="font-medium text-foreground/80">Interactions</h2>
      {listed.length === 0 ? (
        <p className="text-foreground/50">It answers nothing: it plays on its own.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {listed.map(({ cue, does }) => (
            <li key={`${cue}:${does}`} className="flex items-baseline gap-2" data-studio-cue={cue}>
              <span className="w-28 shrink-0 text-label text-foreground/45">
                {BACKDROP_CUE_LABELS[cue]}
              </span>
              <span className="min-w-0 flex-1 text-foreground/75">{does}</span>
              {interacting ? <TryCue cue={cue} owner={owner} /> : null}
            </li>
          ))}
        </ul>
      )}
      {listed.length > 0 && !interacting ? (
        <p className="text-label leading-snug text-foreground/40">Turn on Interact to try them.</p>
      ) : null}
    </section>
  );
}

function TryCue({ cue, owner }: { readonly cue: BackdropCue; readonly owner: StudioActivity }) {
  if (cue === "pointer")
    return <span className="shrink-0 text-label text-foreground/40">move over it</span>;
  const typing = cue === "editing" && owner.typing;
  return (
    <ToolButton
      label={`Try: ${BACKDROP_CUE_LABELS[cue]}`}
      disabled={typing}
      onClick={() => owner.act(cue)}
    >
      {typing ? "Typing…" : "Try"}
    </ToolButton>
  );
}
