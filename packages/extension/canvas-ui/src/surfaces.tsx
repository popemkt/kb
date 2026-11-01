import { lazy, useMemo, useState } from "react";
import { PlusIcon, SquareIcon } from "@phosphor-icons/react";
import { CanvasListView, CanvasView, type CanvasParams } from "@kb/canvas";
import {
  navigate,
  paramsOf,
  SidebarRow,
  SidebarSection,
  useNodes,
  ViewErrorBoundary,
  type MatchedRoute,
  type ViewProps,
} from "@kb/ui-sdk";
import { createCanvasNode, listCanvasNavItems } from "./canvas-api";
import { CANVAS_LIST_PATH, canvasPath } from "./routes";

const CanvasListPage = lazy(() =>
  import("./canvas-list-page").then((m) => ({ default: m.CanvasListPage })),
);
const CanvasPage = lazy(() => import("./canvas-page").then((m) => ({ default: m.CanvasPage })));
const CanvasPreview = lazy(() =>
  import("./canvas-preview").then((m) => ({ default: m.CanvasPreview })),
);

export function CanvasListSurface() {
  return (
    <ViewErrorBoundary title="Canvas crashed" resetKey="canvas-list">
      <CanvasListPage />
    </ViewErrorBoundary>
  );
}

/**
 * One canvas: the live canvas on a page, and as a preview (under the row of
 * the node it is shown for) its still picture.
 */
export function CanvasSurface({ params, host }: ViewProps<CanvasParams>) {
  const { id, item } = params;
  if (host.placement === "preview") return <CanvasPreview canvasId={id} />;
  return (
    <ViewErrorBoundary title="Canvas crashed" resetKey={id}>
      <CanvasPage canvasId={id} item={item} viewNode={host.viewNode} />
    </ViewErrorBoundary>
  );
}

export function CanvasSection({ route }: { readonly route: MatchedRoute | null }) {
  const open = paramsOf(route, CanvasView);
  const nodes = useNodes();
  const canvases = useMemo(() => listCanvasNavItems(nodes), [nodes]);
  const [creating, setCreating] = useState(false);
  const onNew = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const id = await createCanvasNode();
      if (id !== null) navigate(canvasPath({ id }));
    } finally {
      setCreating(false);
    }
  };
  return (
    <SidebarSection>
      <SidebarRow
        label="Canvases"
        icon={<SquareIcon size={14} />}
        active={paramsOf(route, CanvasListView) !== null}
        onClick={() => navigate(CANVAS_LIST_PATH)}
      />
      {canvases.map((c) => (
        <SidebarRow
          key={c.id}
          label={c.label}
          indented
          active={open?.id === c.id}
          onClick={() => navigate(canvasPath({ id: c.id }))}
        />
      ))}
      <SidebarRow
        label={creating ? "Creating…" : "New canvas"}
        icon={<PlusIcon size={14} />}
        indented
        muted
        onClick={() => void onNew()}
      />
    </SidebarSection>
  );
}
