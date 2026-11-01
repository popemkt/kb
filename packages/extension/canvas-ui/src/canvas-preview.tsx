/**
 * A canvas drawn inline (DESIGN-UI.md → Opening a node → a row's handler):
 * its top view as the export paints it (`canvasSvg`, the one painter of a
 * canvas as a picture), fitted to the box its host gives it. A still image,
 * read-only and cheap: it holds no camera, no scene and no gestures, so a
 * canvas goes live only when it is opened. Its host decides when it mounts
 * and how tall it stands.
 */
import { useMemo } from "react";
import { canvasSvg, canvasWorld, isNativeEdgeBound } from "@kb/canvas";
import { useNodes } from "@kb/ui-sdk";

export function CanvasPreview({ canvasId }: { readonly canvasId: string }) {
  const nodes = useNodes();
  const src = useMemo(() => {
    const world = canvasWorld(nodes.values());
    const doc = world.docOf(canvasId);
    if (doc === undefined || doc.nodes.length === 0) return null;
    const svg = canvasSvg(doc, {
      textOf: world.textOf,
      bound: (edge) => isNativeEdgeBound(edge, (node, field) => nodes.get(node)?.props[field]),
    });
    // An image, never inline markup: the picture runs no script, whatever its words say.
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, [nodes, canvasId]);
  if (src === null) {
    return (
      <div className="flex h-full items-center justify-center text-label text-foreground/40">
        Empty canvas
      </div>
    );
  }
  // GAP [[01M54QTGRJYJZ7W5SXDP4356QW]] the preview is the export's picture, so it carries the default design system's tokens, not the page's
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      className="block h-full w-full object-contain"
      data-canvas-preview={canvasId}
    />
  );
}
