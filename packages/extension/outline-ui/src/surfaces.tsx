import { useMemo } from "react";
import { ClockCounterClockwiseIcon, PushPinIcon } from "@phosphor-icons/react";
import { OutlineColumn } from "./outline-column";
import { useOutlineScreen } from "./use-outline-screen";
import { HomeView, type OutlineParams, nodePath } from "@kb/views";
import {
  browserHost,
  listPinnedNavItems,
  type MatchedRoute,
  OpenNodeContext,
  paramsOf,
  plainText,
  SidebarRow,
  SidebarSection,
  usePageGraph,
  usePane,
  useSchema,
  ViewErrorBoundary,
  type ViewProps,
} from "@kb/ui-sdk";
import { useOutlineNodes } from "./outline.store";
import { useRecent, useRecordRecent } from "./recents";

/**
 * The outline: at its `root` when it has one (a node opened in a pane), else
 * at the page's zoom. A rooted outline opens a node by moving its pane to it;
 * the zoomed one zooms, which pushes the zoom's location (`/outline/<id>`).
 * The page has one zoom, which follows the focused pane's location, so two
 * panes at outline locations show the same node. GAP [[01M411FP5AGQ4VB5SGJWCJAN66]]
 */
export function OutlineSurface({ params }: ViewProps<OutlineParams>) {
  const zoomRoot = usePageGraph((s) => s.rootNodeId);
  const homeRoot = usePageGraph((s) => s.homeRootId);
  const { root } = params;
  useRecordRecent(root ?? zoomRoot, homeRoot);
  const pane = usePane();
  const navigatePane = browserHost().navigatePane;
  const open = useMemo(
    () => (root === undefined ? null : (id: string) => navigatePane(pane, nodePath(id))),
    [root, pane, navigatePane],
  );
  useOutlineScreen(root);
  return (
    <OpenNodeContext.Provider value={open}>
      <ViewErrorBoundary title="Outline crashed" resetKey={root ?? zoomRoot}>
        <OutlineColumn root={root} />
      </ViewErrorBoundary>
    </OpenNodeContext.Provider>
  );
}

export function PinnedSection({ route }: { readonly route: MatchedRoute | null }) {
  const nodes = useOutlineNodes();
  const zoomTo = browserHost().zoomTo;
  const rootNodeId = usePageGraph((s) => s.rootNodeId);
  const pinned = useMemo(() => listPinnedNavItems(nodes), [nodes]);
  // The pinned are zoom targets: one is active while the page stands at it.
  const onOutline = paramsOf(route, HomeView) !== null;
  return (
    <SidebarSection title="Pinned">
      {pinned.length === 0 ? (
        <p className="px-2 py-1 text-label text-foreground/30">Pin nodes with ⌘K</p>
      ) : (
        pinned.map((f) => (
          <SidebarRow
            key={f.id}
            label={f.label}
            icon={<PushPinIcon size={14} />}
            active={onOutline && rootNodeId === f.id}
            onClick={() => zoomTo(f.id)}
          />
        ))
      )}
    </SidebarSection>
  );
}

/**
 * Recent: the nodes an outline last stood at, newest first, each a zoom
 * target as a pinned node is; an id the graph no longer holds is not drawn
 * (DESIGN-UI.md → Node-scoped commands, "Recent is screen state").
 */
export function RecentSection({ route }: { readonly route: MatchedRoute | null }) {
  const recent = useRecent();
  const schema = useSchema();
  const zoomTo = browserHost().zoomTo;
  const rootNodeId = usePageGraph((s) => s.rootNodeId);
  const onOutline = paramsOf(route, HomeView) !== null;
  const rows = recent.flatMap((id) => {
    const node = schema.get(id);
    if (node === undefined) return [];
    return [{ id, label: plainText(node.text, (other) => schema.get(other)?.text) || id }];
  });
  return (
    <SidebarSection title="Recent">
      {rows.length === 0 ? (
        <p className="px-2 py-1 text-label text-foreground/30">Nodes you open show here</p>
      ) : (
        rows.map((row) => (
          <SidebarRow
            key={row.id}
            label={row.label}
            icon={<ClockCounterClockwiseIcon size={14} />}
            active={onOutline && rootNodeId === row.id}
            onClick={() => zoomTo(row.id)}
          />
        ))
      )}
    </SidebarSection>
  );
}
