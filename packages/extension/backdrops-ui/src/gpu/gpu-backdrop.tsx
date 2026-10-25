/**
 * The GPU backdrops' React host (DESIGN-UI.md → Page-head backdrops → GPU
 * scenes): it mounts a backdrop's scene through the scene host
 * (`@kb/scene`'s `attachScene`), keeps it given the page (the palette from
 * the tokens and the head's colour, the strength's opacity, the owner's
 * activity) and runs it only while it can be seen: not in a hidden tab, not
 * scrolled out of view (`watchPlayback`), and still under reduced motion.
 * A machine that cannot start it keeps the wash.
 *
 * This module is the first of the two lazy boundaries between the page and
 * three (`UI_LAZY_ONLY`): the plugin imports it with `lazy()`, and it
 * imports each scene, which is three's, with `import()`.
 */
import { useEffect, useRef, useState } from "react";
import { attachScene } from "@kb/scene";
import {
  logWarn,
  readTiming,
  useAppearance,
  useReducedMotion,
  type BackdropProps,
} from "@kb/ui-sdk";
import { watchPlayback } from "../playback";
import { readStagePalette } from "../scene/tokens";
import { TintBackdrop } from "../tint-backdrop";
import type { GpuBackdropMount, GpuBackdropScene, GpuLook } from "./gpu-scene";

/** Each GPU backdrop's scene, behind the second lazy boundary. */
const SCENES = {
  lens: () => import("../lens/lens-scene").then((m) => m.mountLens),
  blackHole: () => import("../black-hole/black-hole-scene").then((m) => m.mountBlackHole),
} satisfies Record<string, () => Promise<GpuBackdropMount>>;

export type GpuSceneId = keyof typeof SCENES;

/** A still is curated: reduced motion always shows the same composition. */
const STILL_SEED = 7;

type SceneState = "loading" | "ready" | "unavailable";

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
  const [seed] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const [state, setState] = useState<SceneState>("loading");
  const { color, direction, opacity, activity, node, pointer } = backdrop;
  const nodeId = node?.id;
  const { writes, editing } = activity;
  const seen = useRef({ writes, nodeId });
  // What a scene mounted later starts from: the page as it is now.
  const latest = useRef<{ look: GpuLook | null; editing: boolean }>({ look: null, editing });
  useEffect(() => {
    const look: GpuLook = {
      palette: readStagePalette(color),
      dark: appearance.dark,
      presence: opacity,
      direction,
    };
    latest.current.look = look;
    mounted.current?.setLook(look);
  }, [appearance, color, direction, opacity]);

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
      mount(el, {
        ...look,
        reducedMotion,
        timing: readTiming(),
        seed: reducedMotion ? STILL_SEED : seed,
        pointer,
      }),
    );
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
      detach();
      mounted.current = null;
    };
  }, [id, reducedMotion, seed, pointer]);

  useEffect(() => {
    latest.current.editing = editing;
    const scene = mounted.current;
    if (scene === null) return;
    scene.setEditing(editing);
    if (writes !== seen.current.writes) scene.write();
    if (nodeId !== seen.current.nodeId) scene.navigate();
    seen.current = { writes, nodeId };
  }, [writes, editing, nodeId]);

  return (
    <>
      {state === "ready" ? null : <TintBackdrop color={color} opacity={opacity} />}
      <div ref={host} className="kb-gpu-backdrop" data-scene-state={state} />
    </>
  );
}
