import { useEffect, useRef } from "react";
import { logWarn, useReducedMotion, type BackdropProps } from "@kb/ui-sdk";
import { watchPlayback } from "./playback";
import { TintBackdrop } from "./tint-backdrop";
import { createUnicornScene, followPointer, type UnicornScene } from "./unicorn-scene";

/**
 * Decorative scene: no hit targets, and no animation while hidden or
 * reduced. Its cursor following is held to the page's pointer source
 * (`followPointer`), checked each frame it plays.
 */
function UnicornBackdrop({ opacity, pointer }: Pick<BackdropProps, "opacity" | "pointer">) {
  const host = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const element = host.current;
    if (!element) return undefined;
    const controller = new AbortController();
    let disposed = false;
    let scene: UnicornScene | null = null;
    let frame = 0;
    const follow = () => {
      if (scene !== null && !scene.paused) followPointer(scene, pointer);
      frame = requestAnimationFrame(follow);
    };
    const watch = watchPlayback(element, reducedMotion, (playing) => {
      if (scene) scene.paused = !playing;
    });
    void createUnicornScene(element, controller.signal)
      .then((ready) => {
        if (disposed) {
          ready.destroy();
          return;
        }
        scene = ready;
        scene.paused = !watch.playing();
        element.dataset.sceneState = "ready";
        follow();
      })
      .catch((error: unknown) => {
        if (disposed) return;
        element.dataset.sceneState = "unavailable";
        logWarn("header backdrop", error);
      });
    return () => {
      disposed = true;
      if (frame !== 0) cancelAnimationFrame(frame);
      // A scene still starting goes with its element, and the runtime's own start throws on it: GAP [[01M73AAXHQQ24FM7EMDA3H1J6R]].
      controller.abort();
      watch.dispose();
      scene?.destroy();
    };
  }, [reducedMotion, pointer]);

  return (
    <div
      ref={host}
      className="kb-unicorn-backdrop"
      style={{ opacity }}
      data-scene-state="loading"
    />
  );
}

/** The unicorn backdrop: the scene over the wash. */
export function UnicornWashBackdrop({ color, opacity, pointer }: BackdropProps) {
  return (
    <>
      <TintBackdrop color={color} opacity={opacity} />
      <UnicornBackdrop opacity={opacity} pointer={pointer} />
    </>
  );
}
