import {
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { drawVariant, shownStrength, shownVariants, type BackdropStrength } from "@kb/model";
import {
  useAppearance,
  useBackdropKnobs,
  useBackdrops,
  usePageActivity,
  usePageBackdrop,
  type PageBackdropChoice,
} from "../hooks";
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
import {
  HostContext,
  type HeadBox,
  type HeadDeclaration,
  type HostPort,
} from "../lib/backdrop-host";
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

const sameBox = (a: HeadBox, b: HeadBox): boolean =>
  a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;

/**
 * Where `space` lies in `region`, by layout rather than by what is painted:
 * offsets up to the region, so neither the region's scroll nor a transform
 * on the way (an enter animation) moves it.
 */
function boxIn(space: HTMLElement, region: HTMLElement): HeadBox {
  let top = 0;
  let left = 0;
  let at: HTMLElement | null = space;
  while (at !== null && at !== region) {
    top += at.offsetTop;
    left += at.offsetLeft;
    const parent: Element | null = at.offsetParent;
    at = parent instanceof HTMLElement ? parent : null;
    if (at !== null && at !== region) {
      top += at.clientTop;
      left += at.clientLeft;
    }
  }
  return { top, left, width: space.offsetWidth, height: space.offsetHeight };
}

/**
 * The page-head slot (DESIGN-UI.md → Page-head backdrops → One slot): the
 * head's space, at the top of the page, holding the head's first row (the
 * breadcrumbs) over the chosen backdrop. A head renders it with its colour
 * and the node it shows, and names no backdrop: which one, how strong and
 * which way are settings (`usePageBackdrop`), the node's own, then core's.
 * It draws nothing itself. It declares the head to its pane's host
 * (`PageBackdropHost`), which draws the backdrop where the space lies, so
 * a backdrop is not mounted again when the page under it changes.
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
  const [space, setSpace] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const region = space?.closest<HTMLElement>("[data-main-region]");
    if (declare === null || space === null || region === null || region === undefined) {
      return undefined;
    }
    let box = boxIn(space, region);
    let withdraw = declare({ color, node, choice, box });
    // The space or the region resized: the head is declared again where it now lies.
    const observer = new ResizeObserver(() => {
      const next = boxIn(space, region);
      if (sameBox(next, box)) return;
      box = next;
      const previous = withdraw;
      withdraw = declare({ color, node, choice, box });
      previous();
    });
    observer.observe(space);
    observer.observe(region);
    return () => {
      observer.disconnect();
      withdraw();
    };
  }, [declare, space, color, node, choice]);
  const presentation = choice.backdrop?.value.presentation;
  return (
    <div
      ref={setSpace}
      className={cn("kb-page-head-space", className)}
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
 * portal and which follows the pane's scroll region (`useBackdropRegion`):
 * a page framed by its route and a page framed by the view it resolves to
 * stand in two different regions (`PageFrame`), and the element moves from
 * one to the other in the commit that swaps them, its canvases and their
 * contexts with it. Being in the region, it scrolls with the page.
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
  // Positioned and unstacked: its layers' own stacking reaches the region's (`HostedBackdrops`).
  const [drawing] = useState(() => {
    if (typeof document === "undefined") return null;
    const element = document.createElement("div");
    element.className = "pointer-events-none absolute inset-x-0 top-0";
    element.dataset.pageBackdropHost = "true";
    return element;
  });
  const port = useMemo<HostPort>(
    () => ({
      declare: (declaration) => {
        setDeclared(declaration);
        return () => setDeclared((current) => (current === declaration ? null : current));
      },
      attach: (region) => {
        if (drawing === null) return () => undefined;
        region.prepend(drawing);
        return () => {
          if (drawing.parentElement === region) drawing.remove();
        };
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

/** The layers once the head chooses `next` (null, none) over `layers`. */
function chosenOver(
  layers: readonly Layer[],
  next: string | null,
  reducedMotion: boolean,
): readonly Layer[] {
  const out: Layer[] = [];
  for (const layer of layers) {
    if (layer.key === next) continue;
    if (layer.leaving !== false) out.push(layer);
    else if (!reducedMotion) out.push({ ...layer, leaving: next === null ? "held" : "now" });
  }
  if (next === null) return out;
  // A backdrop still on its way out is taken back as it is; another comes in over what was shown.
  const back = layers.some((layer) => layer.key === next);
  const enters = !back && !reducedMotion && out.length > 0;
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
 * out, and the head's corner. Their box is the declared space's, held where
 * it was while no head is declared.
 */
function HostedBackdrops({ declared }: { readonly declared: HeadDeclaration | null }) {
  const reducedMotion = useReducedMotion();
  const next = declared?.choice.backdrop?.id ?? null;
  const [layers, setLayers] = useState<readonly Layer[]>([]);
  const [box, setBox] = useState<HeadBox | null>(null);
  const [corner, setCorner] = useState<Corner | null>(null);
  const live = layers.find((layer) => layer.leaving === false)?.key ?? null;
  if (live !== next) setLayers(chosenOver(layers, next, reducedMotion));
  if (declared !== null && (box === null || !sameBox(box, declared.box))) setBox(declared.box);
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
  if (box === null) return null;
  const place: CSSProperties = {
    top: box.top,
    left: box.left,
    width: box.width,
    height: box.height,
  };
  const presentation = declared?.choice.backdrop?.value.presentation;
  return (
    <>
      <div
        className="kb-header-backdrop-space pointer-events-none absolute -z-1"
        style={place}
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
        <div className="pointer-events-none absolute" style={place}>
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
  useLayoutEffect(() => {
    if (element === null) return undefined;
    const { theme, reveal } = readTiming();
    if (leaving === false) {
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
    const fadeOut = withdrawn
      ? undefined
      : element.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: theme * 1000,
          delay: leaving === "held" ? reveal * 1000 : 0,
          easing: "ease-in-out",
          fill: "forwards",
        });
    if (fadeOut === undefined) {
      queueMicrotask(() => onGone(key));
      return undefined;
    }
    // Gone once faded; a fade cancelled (taken back, or the host unmounted) leaves it be.
    fadeOut.finished.then(() => onGone(key)).catch(() => undefined);
    return () => fadeOut.cancel();
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
  onDoubleClick,
}: {
  readonly color: string;
  readonly node: OutlineNode | undefined;
  readonly choice: PageBackdropChoice;
  readonly onDoubleClick?: (room: number) => void;
}) {
  const activity = usePageActivity();
  const [pointer, attachFrame] = usePointerOver();
  const spansRegion = chosen?.value.presentation.span.reach === "region";
  const shift = useBreakoutShift(spansRegion);
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
