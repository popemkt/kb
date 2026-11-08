/**
 * The studio's stage (DESIGN-UI.md → Backdrop Studio → Framing): the
 * viewport the scene is shown in, the scene laid out at its own size
 * (`Framing.scene`) and scaled and placed on screen. Where the scene is
 * larger than the viewport it is panned by dragging it, unless the person
 * is interacting with it, when the pointer is the scene's. What lies over
 * the scene (the knob and interaction panels) is the stage's `overlay`,
 * never scaled.
 */
import { useRef, type ReactNode } from "react";
import { cn } from "@kb/ui-sdk";
import type { Framing } from "./use-framing";

export function StudioStage({
  framing,
  interacting,
  children,
  overlay,
}: {
  readonly framing: Framing;
  /** Whether the pointer is the scene's: then dragging pans nothing. */
  readonly interacting: boolean;
  /** The scene, drawn to fill the box it is given. */
  readonly children: ReactNode;
  readonly overlay: ReactNode;
}) {
  const { scene, scale, place, pannable, measure, panBy } = framing;
  const drag = useRef<{ x: number; y: number } | null>(null);
  const panning = pannable && !interacting;
  return (
    <div
      ref={measure}
      className={cn(
        "relative min-h-0 flex-1 touch-none overflow-hidden bg-foreground/[0.03]",
        panning && "cursor-grab active:cursor-grabbing",
      )}
      data-studio-stage=""
      data-studio-zoom={scale.toFixed(2)}
      onPointerDown={(event) => {
        if (!panning || event.button !== 0) return;
        // A press on a panel over the scene is the panel's.
        if (event.target instanceof Element && event.target.closest("[data-studio-panel]")) return;
        drag.current = { x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const from = drag.current;
        if (from === null) return;
        drag.current = { x: event.clientX, y: event.clientY };
        panBy(event.clientX - from.x, event.clientY - from.y);
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      <div
        className="absolute top-0 left-0 origin-top-left overflow-hidden bg-background ring-1 ring-foreground/10"
        style={{
          width: scene.width,
          height: scene.height,
          transform: `translate(${place.x}px, ${place.y}px) scale(${scale})`,
        }}
        data-studio-scene-size={`${scene.width}x${scene.height}`}
      >
        {children}
      </div>
      {overlay}
    </div>
  );
}
