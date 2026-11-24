/**
 * The layout view (`layout.grid`) shown inside a pane: a dashboard. Its panes
 * are fixed: the arrangement is the view node's. Opened as the workspace, it
 * is moved there, and "Save to layout" writes the arrangement back to this
 * node ("Save workspace" makes a new one beside it).
 * Each of its panes is a pane like any other (its own id, `<outer>:<inner>`,
 * `nestedLayout`, for the outline hosts, the slot chain and the screen), drawn through a slot shown for
 * its location, so a layout that contains itself stops at the first repeat.
 */
import { lazy, Suspense, useState } from "react";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react";
import { layoutPanes, nestedLayout, type LayoutPane, type LayoutParams } from "@kb/views";
import { IconButton, usePane, type ViewProps } from "@kb/ui-sdk";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { PaneFrame } from "./pane-frame";
import { PaneMount } from "./pane-mount";
import { usePaneBodies } from "./use-pane-bodies";

const LayoutGrid = lazy(() => import("./layout-grid"));

const drawPane = (pane: LayoutPane) => <PaneFrame path={pane.path} subject={pane.path} />;

export function LayoutViewSurface({ params, host }: ViewProps<LayoutParams>) {
  const outer = usePane();
  const tree = nestedLayout(params.root, outer);
  const panes = layoutPanes(tree);
  const [focused, setFocused] = useState<string | null>(null);
  const { elementOf, bodies } = usePaneBodies(panes, drawPane, setFocused);
  const replace = useWorkspaceStore((s) => s.replace);
  const [only] = panes;
  return (
    <div className="relative flex h-full min-h-0 flex-col" data-layout-view="dashboard">
      {bodies}
      {only !== undefined && panes.length === 1 ? (
        <PaneMount element={elementOf(only.id)} />
      ) : (
        <Suspense fallback={null}>
          <LayoutGrid
            tree={tree}
            focused={focused}
            elementOf={elementOf}
            movable={false}
            onFocus={setFocused}
          />
        </Suspense>
      )}
      <IconButton
        label="Open as the workspace"
        icon={ArrowsOutSimpleIcon}
        size="md"
        className="absolute right-1.5 top-1 z-10 bg-background/80"
        onClick={() => replace(params.root, host.viewNode ?? null)}
      />
    </div>
  );
}
