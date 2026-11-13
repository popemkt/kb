/**
 * The GPU host's element: the box its scene's canvas is drawn in, carrying
 * the scene's state. It is outside the lazy boundary (`backdrops.tsx`), so
 * the element is there from a backdrop's first render. While the host's
 * chunk loads, the boundary shows it `loading`, and the host renders it
 * with the scene's state once the chunk has loaded. Whether a frame holds
 * this element is how a page tells that a backdrop is drawn by the GPU host.
 */
import type { Ref } from "react";

/** Where a GPU scene is: starting, drawing, or unable to start on this machine. */
export type SceneState = "loading" | "ready" | "unavailable";

export function GpuHostElement({
  state,
  ref,
}: {
  readonly state: SceneState;
  readonly ref?: Ref<HTMLDivElement>;
}) {
  return <div ref={ref} className="kb-gpu-backdrop" data-scene-state={state} />;
}
