/**
 * The GPU backdrops' React host (DESIGN-UI.md → Page-head backdrops → GPU
 * scenes): it mounts a backdrop's scene through the scene host
 * (`@kb/scene`'s `attachScene`), keeps it given the page (the palette from
 * the tokens and the head's colour, the strength's opacity, the owner's
 * activity) and runs it only while it can be seen: not in a hidden tab, not
 * scrolled out of view (`watchPlayback`), and still under reduced motion.
 * A machine that cannot start it gets the wash instead.
 *
 * This module is the first of the two lazy boundaries between the page and
 * three (`UI_LAZY_ONLY`): the plugin imports it with `lazy()`, and it
 * imports each scene, which is three's, with `import()`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { attachScene } from "@kb/scene";
import {
  logWarn,
  readTiming,
  useAppearance,
  useReducedMotion,
  type BackdropProps,
} from "@kb/ui-sdk";
import { watchPlayback } from "../playback";
import { useBackdropSeed } from "../scene/seed";
import { readStagePalette } from "../scene/tokens";
import { useTellOwner } from "../scene/owner";
import { TintBackdrop } from "../tint-backdrop";
import type { ContentBox } from "./framing";
import type { GpuBackdropInit, GpuBackdropMount, GpuBackdropScene, GpuLook } from "./gpu-scene";

/** Each GPU backdrop's scene, behind the second lazy boundary. */
const SCENES = {
  lens: () => import("../lens/lens-scene").then((m) => m.mountLens),
  blackHole: () => import("../black-hole/black-hole-scene").then((m) => m.mountBlackHole),
  toonSea: () => import("../toon-sea/toon-sea-scene").then((m) => m.mountToonSea),
  silk: () => import("../silk/silk-scene").then((m) => m.mountSilk),
  floatingGeometry: () =>
    import("../floating-geometry/floating-geometry-scene").then((m) => m.mountFloatingGeometry),
  gradientOrbs: () => import("../orbs/orbs-scene").then((m) => m.mountGradientOrbs),
  wolfMedallion: () => import("../medallion/medallion-scene").then((m) => m.mountWolfMedallion),
} satisfies Record<string, () => Promise<GpuBackdropMount>>;

export type GpuSceneId = keyof typeof SCENES;

/**
 * Where the head's content lies across the backdrop's frame (`BackdropFrame`,
 * `data-backdrop`), in the frame's own CSS pixels: the part of the frame its
 * holder covers. A frame bounded to the content is all content; one that
 * spans the scroll region holds the content somewhere inside it.
 */
function contentOf(el: HTMLElement): ContentBox {
  const frame = el.closest<HTMLElement>("[data-backdrop]");
  const holder = frame?.parentElement;
  if (!frame || !holder || frame.offsetWidth === 0) return { left: 0, width: el.clientWidth };
  const box = frame.getBoundingClientRect();
  const held = holder.getBoundingClientRect();
  // A card scales its frame: rectangles are in the page's pixels, the scene in the frame's.
  const scale = box.width / frame.offsetWidth;
  const left = Math.max(0, (held.left - box.left) / scale);
  const right = Math.min(frame.offsetWidth, (held.right - box.left) / scale);
  return right > left ? { left, width: right - left } : { left: 0, width: frame.offsetWidth };
}

/** Tell `onChange` whenever the content moves across the frame: either one resizes. */
function watchContent(el: HTMLElement, onChange: (content: ContentBox) => void): () => void {
  const frame = el.closest<HTMLElement>("[data-backdrop]");
  const holder = frame?.parentElement;
  if (!frame || !holder) return () => undefined;
  let last = contentOf(el);
  const observer = new ResizeObserver(() => {
    const next = contentOf(el);
    if (next.left === last.left && next.width === last.width) return;
    last = next;
    onChange(next);
  });
  observer.observe(frame);
  observer.observe(holder);
  return () => observer.disconnect();
}

type SceneState = "loading" | "ready" | "unavailable";

/** What a scene mounted later starts from: the page as it is now. */
interface Latest {
  look: GpuLook | null;
  editing: boolean;
  reducedMotion: boolean;
  seed: number;
}

/** The init a scene mounted now in `el` starts from. */
function initNow(
  el: HTMLElement,
  look: GpuLook,
  latest: Latest,
  pointer: BackdropProps["pointer"],
): GpuBackdropInit {
  const { reducedMotion, seed } = latest;
  return { ...look, reducedMotion, seed, timing: readTiming(), pointer, content: contentOf(el) };
}

export default function GpuBackdrop({
  scene: id,
  backdrop,
}: {
  scene: GpuSceneId;
  backdrop: BackdropProps;
}) {
  const host = useRef<HTMLDivElement>(null);
  const mounted = useRef<GpuBackdropScene | null>(null);
  const appearance = useAppearance();
  const reducedMotion = useReducedMotion();
  const seed = useBackdropSeed(reducedMotion);
  const [state, setState] = useState<SceneState>("loading");
  const { color, direction, art, opacity, activity, node, pointer } = backdrop;
  const nodeId = node?.id;
  const { editing } = activity;
  // A load mounts its scene once: a change of look, motion or editing reaches
  // the scene it mounted, and never mounts another (only another backdrop does).
  const latest = useRef<Latest>({ look: null, editing, reducedMotion, seed });
  useEffect(() => {
    const look: GpuLook = {
      palette: readStagePalette(color),
      dark: appearance.dark,
      presence: opacity,
      direction,
      art,
    };
    latest.current.look = look;
    mounted.current?.setLook(look);
  }, [appearance, art, color, direction, opacity]);

  useEffect(() => {
    const el = host.current;
    const look = latest.current.look;
    if (el === null || look === null) return undefined;
    setState("loading");
    // Running needs both: the tab shown (the scene host's) and the frame in view (`watchPlayback`).
    let shown = true;
    let inView = true;
    let scene: GpuBackdropScene | null = null;
    const apply = () => scene?.setRunning(shown && inView);
    const watch = watchPlayback(el, false, (playing) => {
      inView = playing;
      apply();
    });
    const pending = SCENES[id]().then((mount) =>
      mount(el, initNow(el, look, latest.current, pointer)),
    );
    const unwatch = watchContent(el, (content) => scene?.setContent(content));
    const detach = attachScene(
      el,
      pending.then((made): GpuBackdropScene => {
        scene = made;
        return {
          ...made,
          setRunning: (running) => {
            shown = running;
            apply();
          },
        };
      }),
      {
        onReady: (made) => {
          mounted.current = made;
          // The page may have changed while the scene loaded.
          if (latest.current.look !== null) made.setLook(latest.current.look);
          made.setReducedMotion(latest.current.reducedMotion);
          made.setEditing(latest.current.editing);
          setState("ready");
        },
        onError: (error) => {
          setState("unavailable");
          logWarn("header backdrop", error);
        },
      },
    );
    return () => {
      watch.dispose();
      unwatch();
      detach();
      mounted.current = null;
    };
  }, [id, pointer]);

  useEffect(() => {
    // The seed is the next mount's; the scene already mounted keeps its own.
    latest.current.seed = seed;
    latest.current.reducedMotion = reducedMotion;
    mounted.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion, seed]);

  useEffect(() => {
    latest.current.editing = editing;
  }, [editing]);
  const hears = useCallback(() => mounted.current, []);
  useTellOwner(hears, activity, nodeId);

  return (
    <>
      {/* The wash is the fallback, never a placeholder: a load's one change is the scene's fade-in. */}
      {state === "unavailable" ? <TintBackdrop color={color} opacity={opacity} /> : null}
      <div ref={host} className="kb-gpu-backdrop" data-scene-state={state} />
    </>
  );
}
