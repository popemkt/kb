/**
 * The studio's framing as state (`framing.ts` for the rules): the preview,
 * the zoom and the pan, and the viewport they are measured against.
 */
import { useCallback, useMemo, useState } from "react";
import type { BackdropPresentation } from "@kb/ui-sdk";
import {
  canPan,
  placeScene,
  sceneSize,
  scaleOf,
  zoomAboutCentre,
  zoomIn,
  zoomOut,
  type Point,
  type Preview,
  type Size,
  type Zoom,
} from "./framing.ts";

export interface Framing {
  readonly preview: Preview;
  /** Show the scene as `preview`, fitted. */
  readonly choose: (preview: Preview) => void;
  readonly zoom: Zoom;
  /** The scale it is drawn at now: 1, its own pixels. */
  readonly scale: number;
  /** Its own size. */
  readonly scene: Size;
  readonly viewport: Size;
  /** Where its scaled top-left stands in the viewport. */
  readonly place: Point;
  /** Whether it is larger than the viewport, so there is somewhere to pan. */
  readonly pannable: boolean;
  readonly fit: () => void;
  readonly actual: () => void;
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
  /** Back to the whole scene, fitted and centred. */
  readonly reset: () => void;
  readonly panBy: (dx: number, dy: number) => void;
  /** The viewport's ref: measured while mounted. */
  readonly measure: (viewport: HTMLElement | null) => (() => void) | undefined;
}

const NO_SIZE: Size = { width: 0, height: 0 };

export function useFraming(presentation: Pick<BackdropPresentation, "height">): Framing {
  const [preview, setPreview] = useState<Preview>({ kind: "page" });
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [pan, setPan] = useState<Point | null>(null);
  const [viewport, setViewport] = useState<Size>(NO_SIZE);
  const scene = useMemo(
    () => sceneSize(preview, viewport, presentation),
    [preview, viewport, presentation],
  );
  const scale = scaleOf(zoom, scene, viewport);
  const scaled = { width: scene.width * scale, height: scene.height * scale };
  const place = placeScene(pan, scaled, viewport);
  const zoomTo = (next: number) => {
    setPan(zoomAboutCentre(place, scale, next, viewport));
    setZoom(next);
  };
  const reset = useCallback(() => {
    setZoom("fit");
    setPan(null);
  }, []);
  const measure = useCallback((element: HTMLElement | null) => {
    if (element === null) return undefined;
    const read = () => setViewport({ width: element.clientWidth, height: element.clientHeight });
    read();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return {
    preview,
    choose: (next) => {
      setPreview(next);
      reset();
    },
    zoom,
    scale,
    scene,
    viewport,
    place,
    pannable: canPan(scaled, viewport),
    fit: reset,
    actual: () => zoomTo(1),
    zoomIn: () => zoomTo(zoomIn(scale)),
    zoomOut: () => zoomTo(zoomOut(scale)),
    reset,
    panBy: (dx, dy) => setPan(placeScene({ x: place.x + dx, y: place.y + dy }, scaled, viewport)),
    measure,
  };
}
