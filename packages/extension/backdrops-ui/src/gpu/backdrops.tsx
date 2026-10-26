/**
 * The GPU backdrops as the plugin contributes them: each is the GPU host
 * (`gpu-backdrop.tsx`) behind `lazy()`, the first of its two lazy
 * boundaries, over the wash while it loads.
 */
import { Suspense, lazy } from "react";
import type { BackdropProps } from "@kb/ui-sdk";
import { TintBackdrop } from "../tint-backdrop";
import type { GpuSceneId } from "./gpu-backdrop";

const GpuBackdrop = lazy(() => import("./gpu-backdrop"));

function GpuBackdropHost({ scene, backdrop }: { scene: GpuSceneId; backdrop: BackdropProps }) {
  return (
    <Suspense fallback={<TintBackdrop color={backdrop.color} opacity={backdrop.opacity} />}>
      <GpuBackdrop scene={scene} backdrop={backdrop} />
    </Suspense>
  );
}

/** The dark star in the nebula (`lens/`). */
export function LensBackdrop(props: BackdropProps) {
  return <GpuBackdropHost scene="lens" backdrop={props} />;
}

/** Gargantua (`black-hole/`). */
export function BlackHoleBackdrop(props: BackdropProps) {
  return <GpuBackdropHost scene="blackHole" backdrop={props} />;
}
