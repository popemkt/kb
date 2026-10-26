import { useEffect, useEffectEvent, useRef, useState } from "react";
import { attachScene, readScenePalette } from "@kb/scene";
import {
  logWarn,
  readTiming,
  readTokenColor,
  toRenderableColor,
  useAppearance,
  useReducedMotion,
  type BackdropProps,
} from "@kb/ui-sdk";
import type { ArenaLook, ArenaScene } from "./arena-scene";

/**
 * The page as the Arena paints it: the stage's palette (its ground the page's
 * own background), the purple orbs, the white ship, the head's colour.
 */
function readLook(dark: boolean, head: string): ArenaLook {
  return {
    palette: readScenePalette({
      ground: "--background",
      edge: "--lab-edge",
      hue: "--lab-hue",
      ink: "--foreground",
      accent: "--primary",
    }),
    dark,
    colors: {
      purple: readTokenColor("--canvas-color-6"),
      // White: on the dark page its ink, on the beige page the lightest paper.
      ship: readTokenColor(dark ? "--foreground" : "--popover"),
      shipShare: dark ? 0.85 : 1,
      head: toRenderableColor(head) ?? readTokenColor("--foreground"),
    },
  };
}

/** Feathered at both sides, so the arena fades into the page rather than ending. */
const FEATHER =
  "linear-gradient(to right, transparent, var(--foreground) 14%, var(--foreground) 86%, transparent)";

/**
 * The Arena, YoRHa's other page head (ART-DIRECTION.md → YoRHa): a hacking
 * arena drawn in 3D behind the title (`arena-scene.ts`, loaded on first
 * draw). Decorative, with no hit targets.
 *
 * The scene is mounted once for the life of the head and never again: what
 * changes after (the look, reduced motion, the pointer source, typing, each
 * write) is handed to the running scene, so no keystroke or edit restarts
 * anything. A write is a nudge the play merges and lets decay.
 */
export function ArenaBackdrop({ color, opacity, activity, pointer }: BackdropProps) {
  const host = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<ArenaScene | null>(null);
  const appearance = useAppearance();
  const reducedMotion = useReducedMotion();
  const seen = useRef(activity.writes);
  // The mount starts from the page as it is when it starts.
  const initOf = useEffectEvent(() => ({
    ...readLook(appearance.dark, color),
    timing: readTiming(),
    reducedMotion,
    pointer,
    seed: 7,
  }));
  const ready = useEffectEvent((next: ArenaScene) => {
    if (host.current !== null) host.current.dataset.sceneState = "ready";
    setScene(next);
  });
  const failed = useEffectEvent((error: Error) => {
    if (host.current !== null) host.current.dataset.sceneState = "unavailable";
    logWarn("arena backdrop", error);
  });

  // GAP [[01M5SYY397F5NPN3CHWGCSPQSY]] the Arena mounts and runs its own GPU scene beside the shared host
  useEffect(() => {
    const element = host.current;
    if (element === null) return undefined;
    const init = initOf();
    const mounting = import("./arena-scene").then((m) => m.mountArena(element, init));
    const detach = attachScene(element, mounting, { onReady: ready, onError: failed });
    return () => {
      detach();
      setScene(null);
    };
  }, []);
  // By the time this runs <html> carries the new appearance, so the tokens hold its values.
  useEffect(() => scene?.setLook(readLook(appearance.dark, color)), [scene, appearance, color]);
  useEffect(() => scene?.setReducedMotion(reducedMotion), [scene, reducedMotion]);
  useEffect(() => scene?.setPointer(pointer), [scene, pointer]);
  useEffect(() => scene?.setEditing(activity.editing), [scene, activity.editing]);
  useEffect(() => {
    if (activity.writes === seen.current) return;
    seen.current = activity.writes;
    // A write is a passing gesture, and no gesture plays under reduced motion.
    if (!reducedMotion) scene?.write();
  }, [scene, activity.writes, reducedMotion]);

  return (
    <div
      ref={host}
      className="kb-arena"
      data-scene-state="loading"
      style={{
        position: "absolute",
        inset: 0,
        opacity,
        maskImage: FEATHER,
        WebkitMaskImage: FEATHER,
      }}
    />
  );
}
