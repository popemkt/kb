/**
 * One backdrop in the studio (DESIGN-UI.md → Backdrop Studio): its scene,
 * the only one running, under a thin header (back to the gallery, its name
 * and credit, the extension it comes from if a plugin's, a variant
 * switcher, a strength preview, the perf readout, and "Use as my page
 * backdrop") and the framing bar (its preview size, zoom and pan, and
 * Interact), with the knob and interaction panels over it. The frame is the
 * one every head draws (`BackdropFrame`), so what the studio shows is what a
 * page head shows.
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowLeftIcon, CheckIcon } from "@phosphor-icons/react";
import {
  BACKDROP_STRENGTHS,
  backdropOptionId,
  backdropVariantId,
  backdropVariantOptionId,
  drawVariant,
  shownStrength,
  shownVariants,
  type BackdropStrength,
} from "@kb/appearance";
import { SYSTEM_IDS, extensionNodeId } from "@kb/model";
import { BackdropFrame, type Backdrop, usePageBackdrop } from "@kb/appearance-kit";
import {
  browserHost,
  navigate,
  useAppearance,
  useLoadSeed,
  useNode,
  usePointerOver,
} from "@kb/ui-sdk";

import { KnobPanel, type KnobGroup } from "./knob-panel";
import { gatedPointer, useStudioActivity } from "./interact";
import { PerfReadout } from "./perf-readout";
import { studioPath } from "./routes";
import { Segments } from "./segments";
import { FramingBar, InteractionsPanel } from "./studio-controls";
import { StudioStage } from "./studio-stage";
import { useFraming } from "./use-framing";

/** Make `id` the backdrop every page head shows by default: core's setting, as Settings writes it. */
function UseAsPageBackdrop({ id }: { readonly id: string }) {
  const page = usePageBackdrop();
  const core = useNode(extensionNodeId("core"));
  const mine = page.backdrop?.value.key.id === id;
  if (mine)
    return (
      <span className="flex items-center gap-1 text-meta text-foreground/55">
        <CheckIcon size={12} aria-hidden="true" />
        Your page backdrop
      </span>
    );
  return (
    <button
      type="button"
      className="flex h-6 items-center rounded-md bg-primary px-2.5 text-meta font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-primary"
      onClick={() =>
        void browserHost().writes.updateProp(
          extensionNodeId("core"),
          SYSTEM_IDS.backdropField,
          { t: "ref", v: backdropOptionId(id) },
          core?.props[SYSTEM_IDS.backdropField]?.[0],
        )
      }
    >
      Use as my page backdrop
    </button>
  );
}

const STRENGTH_LABELS: Readonly<Record<BackdropStrength, string>> = {
  subtle: "Subtle",
  soft: "Soft",
  vivid: "Vivid",
};

interface Shown {
  readonly variant: string | null;
  readonly strength: BackdropStrength;
}

function StudioHeader({
  backdrop,
  from,
  shown,
  onShow,
  frame,
}: {
  readonly backdrop: Backdrop;
  readonly from: string | null;
  readonly shown: Shown;
  readonly onShow: (shown: Shown) => void;
  readonly frame: HTMLElement | null;
}) {
  const { key, budget } = backdrop;
  const variants = key.variants ?? [];
  return (
    <header className="relative z-10 flex min-h-11 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5">
      <button
        type="button"
        className="flex items-center gap-1 rounded-md px-1.5 text-meta text-foreground/50 hover:text-foreground/80 focus-visible:outline focus-visible:outline-primary"
        onClick={() => navigate(studioPath())}
      >
        <ArrowLeftIcon size={12} aria-hidden="true" />
        All backdrops
      </button>
      <h1 className="flex items-baseline gap-2 text-ui font-medium text-foreground/80">
        {key.label}
        {key.credit === undefined ? null : (
          <span className="text-label font-normal text-foreground/40">{key.credit}</span>
        )}
        {from === null ? null : (
          <span className="text-label font-normal text-foreground/40" data-studio-from={from}>
            from {from}
          </span>
        )}
      </h1>
      {variants.length > 1 && shown.variant !== null ? (
        <Segments
          label="Variant"
          options={variants}
          value={shown.variant}
          onChange={(variant) => onShow({ ...shown, variant })}
        />
      ) : null}
      <Segments
        label="Strength (preview)"
        options={BACKDROP_STRENGTHS.map((id) => ({ id, label: STRENGTH_LABELS[id] }))}
        value={shown.strength}
        onChange={(strength) => onShow({ ...shown, strength })}
      />
      <span className="flex-1" />
      <PerfReadout frame={frame} budget={budget} />
      <UseAsPageBackdrop id={key.id} />
    </header>
  );
}

/** The knob groups `backdrop` shows with `variant`: its own, then the variant's. */
function groupsOf(backdrop: Backdrop, variant: string | null): KnobGroup[] {
  const { key } = backdrop;
  const own = { title: key.label, holder: backdropOptionId(key.id), knobs: key.knobs ?? [] };
  const drawn = key.variants?.find(({ id }) => id === variant);
  if (drawn === undefined || variant === null) return [own];
  return [
    own,
    {
      title: `${key.label} · ${drawn.label}`,
      holder: backdropVariantOptionId(key.id, variant),
      knobs: drawn.knobs ?? [],
    },
  ];
}

/** The variant and strength the studio opens on: the ones a page head would show now. */
function useOpening(backdrop: Backdrop): Shown {
  const { key } = backdrop;
  const { dark } = useAppearance();
  const seed = useLoadSeed();
  const page = usePageBackdrop();
  const variant = drawVariant(
    seed,
    shownVariants(key, page.variants, dark ? "dark" : "light"),
    null,
  );
  return { variant, strength: shownStrength(page.strength, key, variant) };
}

export function StudioScene({
  id,
  backdrop,
  from,
}: {
  readonly id: string;
  readonly backdrop: Backdrop;
  /** The repository extension it comes from, when it is a plugin's. */
  readonly from: string | null;
}) {
  const opening = useOpening(backdrop);
  const [shown, setShown] = useState(opening);
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const [pointer, attachPointer] = usePointerOver();
  const page = usePageBackdrop();
  const framing = useFraming(backdrop.presentation);
  const owner = useStudioActivity();
  const [interacting, setInteracting] = useState(false);
  // The scene's pointer is one source for the scene's life; Interact opens and closes it.
  const [gate] = useState(() => gatedPointer(pointer));
  useEffect(() => gate.open(interacting), [gate, interacting]);
  const frameRef = useCallback(
    (el: HTMLDivElement | null) => {
      setFrame(el);
      const detach = attachPointer(el);
      return () => {
        setFrame(null);
        detach?.();
      };
    },
    [attachPointer],
  );
  const { key } = backdrop;
  return (
    <div
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background"
      data-studio-backdrop={key.id}
    >
      <StudioHeader backdrop={backdrop} from={from} shown={shown} onShow={setShown} frame={frame} />
      <FramingBar framing={framing} interacting={interacting} onInteract={setInteracting} />
      <StudioStage
        framing={framing}
        interacting={interacting}
        overlay={
          <div className="pointer-events-none absolute inset-y-4 right-4 z-10 flex w-80 max-w-[calc(100%-2rem)] flex-col overflow-y-auto">
            <div className="mt-auto flex flex-col gap-3">
              <InteractionsPanel
                interactions={backdrop.interactions}
                interacting={interacting}
                owner={owner}
              />
              <KnobPanel groups={groupsOf(backdrop, shown.variant)} />
            </div>
          </div>
        }
      >
        <BackdropFrame
          id={id}
          backdrop={backdrop}
          frameRef={frameRef}
          placement={{ left: 0, top: 0, width: "100%", height: "100%" }}
          color="var(--primary)"
          node={owner.node}
          strength={shown.strength}
          direction={page.direction}
          art={page.art}
          pinned={shown.variant === null ? [] : [backdropVariantId(key.id, shown.variant)]}
          activity={owner.activity}
          pointer={gate.pointer}
        />
      </StudioStage>
    </div>
  );
}
