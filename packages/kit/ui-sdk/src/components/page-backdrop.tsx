import {
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { drawVariant, shownStrength, shownVariants, type BackdropStrength } from "@kb/appearance";
import {
  useAppearance,
  useBackdropKnobs,
  useBackdrops,
  usePageActivity,
  usePageBackdrop,
  type PageBackdropChoice,
} from "../hooks.ts";
import { watchBackdropDoubleClick } from "../lib/backdrop-gesture";
import { BREAKOUT_CLASS, useBreakoutShift } from "../lib/breakout";
import { useLoadSeed } from "../lib/load-seed";
import { cn } from "../lib/cn";
import { useReducedMotion } from "../lib/motion";
import { readTiming } from "../lib/timing";
import type { Backdrop, BackdropPresentation, BackdropProps } from "../lib/plugins";
import { usePointerOver } from "../lib/pointer-over";
import type { OutlineNode } from "../lib/types";
import { cornerTop } from "../lib/backdrop-corner-place";
import { HostContext, type HeadDeclaration, type HostPort } from "../lib/backdrop-host";
import { BackdropCorner } from "./backdrop-corner";

/**
 * A backdrop's frame: the box its component draws in, as tall as its
 * presentation says, clipped, inert and hidden, carrying which backdrop it
 * is and which way it faces. Where the frame stands is its host's
 * (`placement`, and a class that places it): a page head centres it under
 * the head or spans the scroll region with it, a card scales it into the
 * card. It decides what the component shows, in one place: of the variants
 * its settings pin, those it may show on this page's scheme
 * (`shownVariants`), the one the load's seed draws of them (`drawVariant`,
 * kept while it is still among them), the strength it shows that variant
 * at (`shownStrength`: the one chosen, else the variant's own, else the
 * default), the presentation's opacity at that strength, and the values
 * of the knobs it shows with that variant, as their nodes hold them
 * (`useBackdropKnobs`).
 */
export function BackdropFrame({
  id,
  backdrop: { key, presentation, budget, Component },
  placement,
  className,
  frameRef,
  pinned,
  strength: chosen,
  ...props
}: Omit<BackdropProps, "variant" | "opacity" | "strength" | "knobs" | "budget"> & {
  readonly id: string;
  readonly backdrop: Backdrop;
  readonly placement: CSSProperties;
  readonly className?: string;
  readonly frameRef?: Ref<HTMLDivElement>;
  /** The variants pinned, by declared id (`PageBackdropChoice.variants`). */
  readonly pinned: readonly string[];
  /** The strength chosen; null, none (`PageBackdropChoice.strength`). */
  readonly strength: BackdropStrength | null;
}) {
  const { dark } = useAppearance();
  const shown = shownVariants(key, pinned, dark ? "dark" : "light");
  const seed = useLoadSeed();
  const [drawn, setDrawn] = useState(() => drawVariant(seed, shown, null));
  const variant = drawVariant(seed, shown, drawn);
  if (variant !== drawn) setDrawn(variant);
  const strength = shownStrength(chosen, key, variant);
  const knobs = useBackdropKnobs(key, variant);
  return (
    <div
      ref={frameRef}
      className={cn("kb-header-backdrop pointer-events-none", className)}
      data-backdrop={id}
      data-direction={props.direction}
      style={{
        position: "absolute",
        overflow: "hidden",
        height: presentation.height,
        ...placement,
      }}
      aria-hidden="true"
      data-header-wash="true"
    >
      <Component
        {...props}
        variant={variant}
        strength={strength}
        opacity={presentation.opacity[strength]}
        knobs={knobs}
        budget={budget}
      />
    </div>
  );
}

/** Where a page head stands its frame: by its span, at its offset. */
function placementOf({ span, offset }: BackdropPresentation): {
  readonly placement: CSSProperties;
  readonly className?: string;
} {
  if (span.reach === "region")
    return { placement: { left: 0, top: offset }, className: BREAKOUT_CLASS };
  return {
    placement: {
      left: "50%",
      width: "100%",
      transform: "translateX(-50%)",
      maxWidth: span.maxWidth,
      top: offset,
    },
  };
}

/**
 * The page-head slot (DESIGN-UI.md → Page-head backdrops → One slot): the
 * head's space, at the top of the page, holding the head's first row (the
 * breadcrumbs) over the chosen backdrop. A head renders it with its colour
 * and the node it shows, and names no backdrop: which one, how strong and
 * which way are settings (`usePageBackdrop`), the node's own, then core's.
 * It draws nothing itself. It declares the head and its space to its
 * pane's host (`PageBackdropHost`), which draws the backdrop in that space,
 * so layout places it with the page, and a backdrop is not mounted again
 * when the page under it changes.
 *
 * The space is as tall as the backdrop's presentation asks, and never less
 * than what it holds; the rows it holds stand on a soft scrim of the page's
 * ground (`HeadBand`), so they read over any backdrop. Canvas and graph
 * pages have no head yet, so nothing declares a backdrop there. GAP [[01M54CEKJJXNDPYNT55AR6KEV8]]
 */
export function PageBackdrop({
  color,
  node,
  className,
  children,
}: {
  readonly color: string;
  readonly node?: OutlineNode;
  /** The space's own class: its padding below what it holds, say. */
  readonly className?: string;
  /** What the head shows over the top of its backdrop: its breadcrumbs. */
  readonly children?: ReactNode;
}) {
  const declare = useContext(HostContext)?.declare ?? null;
  const choice = usePageBackdrop(node);
  // A ref, not state: the head declares in the commit it mounts in, the one the page it
  // replaces withdraws in, so the host sees one head give way to the next and holds nothing.
  const space = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = space.current;
    return declare === null || element === null
      ? undefined
      : declare({ color, node, choice, space: element });
  }, [declare, color, node, choice]);
  const presentation = choice.backdrop?.value.presentation;
  return (
    <div
      ref={space}
      className={cn("kb-page-head-space relative", className)}
      data-page-head-space="true"
      style={
        presentation === undefined ? undefined : { minHeight: `min(${presentation.space}px, 24vw)` }
      }
    >
      {children === undefined ? null : (
        <HeadBand scrim={presentation !== undefined}>{children}</HeadBand>
      )}
    </div>
  );
}

/**
 * The rows a head's space holds, as wide as they are, on a scrim of the
 * page's ground when a backdrop lies under them. The scrim is the ground
 * itself, reaching past the rows by twice its blur, so under every glyph it
 * is at least nine parts ground: muted text keeps AA contrast over any
 * backdrop, light or dark (`head-band-contrast.e2e.ts`), and the backdrop
 * shows all round it, through soft edges rather than a band's. It stands in
 * the region's negative layer, over the backdrop and under every box of the
 * page.
 */
function HeadBand({ scrim, children }: { readonly scrim: boolean; readonly children: ReactNode }) {
  return (
    <div className="relative w-fit max-w-full" data-head-band="true">
      {scrim ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-x-4 -inset-y-1 -z-1 rounded-full bg-background blur-sm"
          data-head-scrim="true"
        />
      ) : null}
      {children}
    </div>
  );
}

/**
 * A pane's backdrop host (DESIGN-UI.md → Page-head backdrops → One
 * backdrop across pages): the one place a page-head backdrop is drawn,
 * mounted once for the pane, above the router, so moving between pages
 * never mounts a backdrop again. The page's head declares itself
 * (`PageBackdrop`) and the host draws the backdrop it chose where its space
 * lies, in the negative layer of the scroll region the page stands in.
 *
 * The drawing is the host's own element, which it renders into through a
 * portal and puts in the declared head's space: layout places it with the
 * page, in the region the page stands in (a page framed by its route and a
 * page framed by the view it resolves to stand in two, `PageFrame`), and
 * it moves to the next page's space in the commit that shows it, its
 * canvases and their contexts with it. While no head is declared it stays
 * in the space it was in, and leaves the page with it.
 *
 * A page that chooses the backdrop already drawn keeps it: its frame, its
 * scene, its clock and its GPU context; the new page's colour, node and
 * settings reach it as props. A page that chooses another crossfades to it
 * (`HostedBackdrops`), and under reduced motion swaps at once. While no
 * page declares a head (a page with none, or the next page still loading)
 * the backdrop is held for a reveal and then fades out, so a page that
 * declares the same backdrop meanwhile finds it still running.
 */
export function PageBackdropHost({ children }: { readonly children: ReactNode }) {
  const [declared, setDeclared] = useState<HeadDeclaration | null>(null);
  // Over the whole space and unstacked: its layers' own stacking reaches the region's (`HostedBackdrops`).
  const [drawing] = useState(() => {
    if (typeof document === "undefined") return null;
    const element = document.createElement("div");
    element.className = "pointer-events-none absolute inset-0";
    element.dataset.pageBackdropHost = "true";
    return element;
  });
  const port = useMemo<HostPort>(
    () => ({
      // The drawing moves in as the head declares itself, in the commit that shows it, so
      // what the host draws is laid out in the space before it renders for the new head.
      declare: (declaration) => {
        if (drawing !== null && drawing.parentElement !== declaration.space) {
          declaration.space.prepend(drawing);
        }
        setDeclared(declaration);
        return () => setDeclared((current) => (current === declaration ? null : current));
      },
    }),
    [drawing],
  );
  return (
    <HostContext.Provider value={port}>
      {drawing === null ? null : createPortal(<HostedBackdrops declared={declared} />, drawing)}
      {children}
    </HostContext.Provider>
  );
}

/**
 * A backdrop the host draws, by its declared id: the one the declared head
 * chose (`leaving: false`), or one on its way out, at once (`"now"`, for
 * another backdrop) or after a reveal's hold (`"held"`, for no head).
 */
interface Layer {
  readonly key: string;
  readonly leaving: false | "now" | "held";
  /** It fades in: it replaced a backdrop that was shown. */
  readonly enters: boolean;
}

/**
 * Whether `layers` draw `next` (null, none) as the head chose it: it is the
 * one shown, and under reduced motion nothing fades in or out beside it.
 */
function drawsChosen(
  layers: readonly Layer[],
  next: string | null,
  reducedMotion: boolean,
): boolean {
  const live = layers.find((layer) => layer.leaving === false)?.key ?? null;
  return (
    live === next &&
    (!reducedMotion || layers.every((layer) => layer.leaving === false && !layer.enters))
  );
}

/**
 * The layers once the head chooses `next` (null, none) over `layers`. Under
 * reduced motion that is the chosen one alone, held still: whatever was
 * fading in or out when motion was reduced is cut, not left to finish.
 */
function chosenOver(
  layers: readonly Layer[],
  next: string | null,
  reducedMotion: boolean,
): readonly Layer[] {
  if (reducedMotion) return next === null ? [] : [{ key: next, leaving: false, enters: false }];
  const out: Layer[] = [];
  for (const layer of layers) {
    if (layer.key === next) continue;
    out.push(
      layer.leaving === false ? { ...layer, leaving: next === null ? "held" : "now" } : layer,
    );
  }
  if (next === null) return out;
  // A backdrop still on its way out is taken back as it is; another comes in over what was shown.
  const back = layers.some((layer) => layer.key === next);
  const enters = !back && out.length > 0;
  return [...out, { key: next, leaving: false, enters }];
}

/** The head's corner as a double-click showed it: a new key each time, and the room it had then. */
interface Corner {
  readonly key: number;
  readonly backdrop: string;
  readonly room: number;
}

/**
 * What the host draws: the declared head's backdrop, the ones still fading
 * out, and the head's corner, over the whole of the space the drawing is
 * in.
 */
function HostedBackdrops({ declared }: { readonly declared: HeadDeclaration | null }) {
  const reducedMotion = useReducedMotion();
  const next = declared?.choice.backdrop?.id ?? null;
  const [layers, setLayers] = useState<readonly Layer[]>([]);
  const [corner, setCorner] = useState<Corner | null>(null);
  if (!drawsChosen(layers, next, reducedMotion)) setLayers(chosenOver(layers, next, reducedMotion));
  const gone = useCallback(
    (key: string) =>
      setLayers((now) => now.filter((layer) => layer.key !== key || layer.leaving === false)),
    [],
  );
  const showCorner = useCallback(
    (backdrop: string, room: number) =>
      setCorner((shown) => ({ key: (shown?.key ?? 0) + 1, backdrop, room })),
    [],
  );
  const closeCorner = useCallback(() => setCorner(null), []);
  const presentation = declared?.choice.backdrop?.value.presentation;
  return (
    <>
      <div
        className="kb-header-backdrop-space pointer-events-none absolute inset-0 -z-1"
        aria-hidden="true"
        data-page-backdrop="true"
      >
        {layers.map((layer) => (
          <HostLayer
            key={layer.key}
            layer={layer}
            declared={layer.leaving === false ? declared : null}
            onGone={gone}
            onDoubleClick={showCorner}
          />
        ))}
      </div>
      {corner === null || corner.backdrop !== next || presentation === undefined ? null : (
        <div className="pointer-events-none absolute inset-0">
          <BackdropCorner
            key={corner.key}
            backdrop={declared?.choice.backdrop?.value.key.id ?? corner.backdrop}
            top={cornerTop(presentation, corner.room)}
            onClose={closeCorner}
          />
        </div>
      )}
    </>
  );
}

/**
 * One backdrop the host draws, in a box as large as the head's space. While
 * the head chose it, it is drawn as the head declares it; on its way out it
 * is drawn as it was last declared, fading out, and gone once faded, or at
 * once when its family no longer contributes it (a plugin's backdrop whose
 * plugin was unloaded draws nothing more).
 */
function HostLayer({
  layer,
  declared,
  onGone,
  onDoubleClick,
}: {
  readonly layer: Layer;
  readonly declared: HeadDeclaration | null;
  readonly onGone: (key: string) => void;
  readonly onDoubleClick: (backdrop: string, room: number) => void;
}) {
  const [held, setHeld] = useState(declared);
  if (declared !== null && declared !== held) setHeld(declared);
  const drawn = declared ?? held;
  const contributed = useBackdrops().shown;
  const chosen = drawn?.choice.backdrop;
  // Each reader decodes its own copy of a contribution, so it is known by its id and its component.
  const withdrawn =
    chosen === null ||
    chosen === undefined ||
    !contributed.some(
      ({ id, value }) => id === chosen.id && value.Component === chosen.value.Component,
    );
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const { leaving, enters, key } = layer;
  // When it began to leave, and for how long: the layer's own, so the effect that shows its fade
  // can be disconnected and run again (a page above the host suspends and shows again) and pick
  // the fade up where it was rather than start it over.
  const leftAt = useRef<{
    readonly since: number;
    readonly delay: number;
    readonly theme: number;
  } | null>(null);
  useLayoutEffect(() => {
    if (element === null) return undefined;
    const { theme, reveal } = readTiming();
    if (leaving === false) {
      leftAt.current = null;
      if (!enters) return undefined;
      const fadeIn = element.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: theme * 1000,
        easing: "ease-in-out",
        fill: "backwards",
      });
      // A fade cut short (the layer leaves, or goes) rejects its `finished`: nothing waits on it.
      fadeIn.finished.catch(() => undefined);
      return () => fadeIn.cancel();
    }
    if (withdrawn) {
      queueMicrotask(() => onGone(key));
      return undefined;
    }
    leftAt.current ??= {
      since: performance.now(),
      delay: (leaving === "held" ? reveal : 0) * 1000,
      theme: theme * 1000,
    };
    const left = leftAt.current;
    const fadeOut = element.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: left.theme,
      delay: left.delay,
      easing: "ease-in-out",
      fill: "forwards",
    });
    const elapsed = performance.now() - left.since;
    fadeOut.currentTime = elapsed;
    // Cancelled when taken back, or when the host unmounts: nothing waits on its `finished`.
    fadeOut.finished.catch(() => undefined);
    // Gone when its time is up, by the clock rather than by the fade: an animation moves only
    // as frames are drawn, and a page whose frames stall (a busy GPU, a hidden tab) still lets
    // the scene it leaves go. Taken back, or the host unmounted, it is let be.
    const timer = setTimeout(() => onGone(key), Math.max(0, left.delay + left.theme - elapsed));
    return () => {
      clearTimeout(timer);
      fadeOut.cancel();
    };
  }, [element, leaving, enters, withdrawn, key, onGone]);
  const doubleClicked = useCallback(
    (room: number) => onDoubleClick(key, room),
    [key, onDoubleClick],
  );
  return (
    <div
      ref={setElement}
      className="absolute inset-0"
      data-backdrop-layer={leaving === false ? "shown" : "leaving"}
    >
      {drawn === null || withdrawn ? null : (
        <HeadBackdropFrame
          color={drawn.color}
          node={drawn.node}
          choice={drawn.choice}
          space={drawn.space}
          onDoubleClick={leaving === false ? doubleClicked : undefined}
        />
      )}
    </div>
  );
}

/**
 * A head's backdrop, framed by its presentation and wired to the page: the
 * owner's activity, the pointer over the frame (`usePointerOver`), a
 * region-spanning frame's breakout (`useBreakoutShift`) and a double-click
 * on the backdrop's own area (`watchBackdropDoubleClick`), which asks for
 * its actions in the head's corner with the breathing room it has then
 * (`BackdropCorner`, placed by `cornerTop`; the host shows it, a
 * positioned layer of its own beside the frame's, so it paints, and is
 * clicked, above the page). Renders nothing when nothing is chosen.
 */
export function HeadBackdropFrame({
  color,
  node,
  choice: { backdrop: chosen, strength, direction, art, variants },
  space,
  onDoubleClick,
}: {
  readonly color: string;
  readonly node: OutlineNode | undefined;
  readonly choice: PageBackdropChoice;
  /** The head's space it is drawn in, when its host carries it from page to page. */
  readonly space?: HTMLElement;
  readonly onDoubleClick?: (room: number) => void;
}) {
  const activity = usePageActivity();
  const [pointer, attachFrame] = usePointerOver();
  const spansRegion = chosen?.value.presentation.span.reach === "region";
  const shift = useBreakoutShift(spansRegion, space);
  const frameRef = useCallback(
    (frame: HTMLDivElement | null) => {
      shift(frame);
      const detach = attachFrame(frame);
      const unwatch =
        frame === null || onDoubleClick === undefined
          ? undefined
          : watchBackdropDoubleClick(frame, () =>
              onDoubleClick(frame.parentElement?.getBoundingClientRect().height ?? 0),
            );
      return () => {
        shift(null);
        detach?.();
        unwatch?.();
      };
    },
    [attachFrame, shift, onDoubleClick],
  );
  if (chosen === null) return null;
  return (
    <BackdropFrame
      id={chosen.id}
      backdrop={chosen.value}
      frameRef={frameRef}
      {...placementOf(chosen.value.presentation)}
      color={color}
      node={node}
      strength={strength}
      direction={direction}
      art={art}
      pinned={variants}
      activity={activity}
      pointer={pointer}
    />
  );
}
