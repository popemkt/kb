import { Effect } from "effect";
import { coreExtension } from "@kb/operations";
import { familyTags } from "@kb/contracts";
import { definePlugin } from "@kb/plugin";
import { HomeView, LAYOUT_NAMESPACE, LayoutView, NodeReadView, NodeView } from "@kb/views";
import { provideRoute, provideView, RoutePoint, SidebarSectionPoint, ViewPoint } from "@kb/ui-sdk";
import { HomeSection, HomeSurface } from "./home";
import { LayoutViewSurface } from "./layout-view";
import { NodeReadSurface } from "./node-read";
import { NodeViewSurface } from "./node-view";
import { matchHome, matchNode } from "./routes";

/**
 * Layouts, the home and the node route: the layout view (`layout.grid`, a
 * dashboard when shown inside a pane), `/node/<id>[/<view>]`, the one route
 * a node is opened by, the home at `/` and `/outline/<id>` (where the page
 * stands, in the store's default view type) with its sidebar row, and the
 * read view a node opens in where that view is not loaded. So no family is
 * one the page needs to open a node or stand anywhere. The workspace's own
 * panes are the shell's (`components/layout/workspace`), drawn with the same
 * grid.
 */
export const layoutUiPlugin = definePlugin({
  name: LAYOUT_NAMESPACE,
  tags: familyTags(coreExtension, "ui"),
  apply: (ctx) =>
    Effect.all(
      [
        ctx.contribute(
          ViewPoint,
          provideView(LayoutView, {
            placements: ["page"],
            sample: { root: { tabs: [{ id: "a", path: "/" }] } },
            Component: LayoutViewSurface,
          }),
        ),
        ctx.contribute(
          ViewPoint,
          provideView(NodeView, {
            placements: ["page"],
            sample: { node: "n.root-a" },
            Component: NodeViewSurface,
          }),
        ),
        ctx.contribute(
          RoutePoint,
          provideRoute({
            view: NodeView,
            match: matchNode,
            // The page it resolves to frames itself (NodeViewSurface, PageFrame):
            // a frame here would hold that page's scroll region inside its own.
            frame: () => "full",
            pendingTitle: () => "Opening…",
          }),
        ),
        ctx.contribute(
          ViewPoint,
          provideView(HomeView, { placements: ["page"], sample: {}, Component: HomeSurface }),
        ),
        ctx.contribute(
          RoutePoint,
          provideRoute({
            view: HomeView,
            match: matchHome,
            entry: "/",
            frame: () => "scroll",
            pendingTitle: () => "Opening your workspace…",
          }),
        ),
        ctx.contribute(
          ViewPoint,
          provideView(NodeReadView, {
            placements: ["page"],
            sample: { root: "n.root-a" },
            Component: NodeReadSurface,
            frame: "scroll",
          }),
        ),
        ctx.contribute(SidebarSectionPoint, {
          id: "home",
          value: { order: 0, Component: HomeSection },
        }),
      ],
      { discard: true },
    ),
});
