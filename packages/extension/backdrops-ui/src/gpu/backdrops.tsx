/**
 * The GPU backdrops as the plugin contributes them: each is the GPU host
 * (`gpu-backdrop.tsx`) behind `lazy()`, the first of its two lazy
 * boundaries. Nothing stands in while it loads: the wash is only the
 * fallback of a machine that cannot start the scene.
 */
import { Suspense, lazy } from "react";
import type { BackdropProps } from "@kb/ui-sdk";
import type { GpuSceneId } from "./gpu-backdrop";

const GpuBackdrop = lazy(() => import("./gpu-backdrop"));

function GpuBackdropHost({ scene, backdrop }: { scene: GpuSceneId; backdrop: BackdropProps }) {
  return (
    <Suspense fallback={null}>
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

/** A web of glass facets on deep navy, gold light where they meet (`floating-geometry/`). */
export function FloatingGeometryBackdrop(props: BackdropProps) {
  return <GpuBackdropHost scene="floatingGeometry" backdrop={props} />;
}

/** Two great orbs floating in front of a deep blue field (`orbs/`). */
export function GradientOrbsBackdrop(props: BackdropProps) {
  return <GpuBackdropHost scene="gradientOrbs" backdrop={props} />;
}

/** kb's steel wolf medallion over smoke and embers, trembling when something happens (`medallion/`). */
export function WolfMedallionBackdrop(props: BackdropProps) {
  return <GpuBackdropHost scene="wolfMedallion" backdrop={props} />;
}

/** Long-exposure light streaking across a deep navy field (`light-trails/`). */
export function LightTrailsBackdrop(props: BackdropProps) {
  return <GpuBackdropHost scene="lightTrails" backdrop={props} />;
}
