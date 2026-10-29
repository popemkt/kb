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

/** The cel-shaded sea under anime clouds (`toon-sea/`). */
export function ToonSeaBackdrop(props: BackdropProps) {
  return <GpuBackdropHost scene="toonSea" backdrop={props} />;
}

/** Layered silk on a stage before a faint cosmos (`silk/`). */
export function SilkBackdrop(props: BackdropProps) {
  return <GpuBackdropHost scene="silk" backdrop={props} />;
}

/** Glass shards drifting in the dark, amber light through them (`floating-geometry/`). */
export function FloatingGeometryBackdrop(props: BackdropProps) {
  return <GpuBackdropHost scene="floatingGeometry" backdrop={props} />;
}
