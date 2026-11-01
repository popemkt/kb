import { Effect } from "effect";
import { SquareIcon } from "@phosphor-icons/react";
import { familyTags } from "@kb/contracts";
import { definePlugin } from "@kb/plugin";
import { CANVAS_LIST_PATH, matchCanvas, matchCanvasList } from "./routes";
import { CanvasListSurface, CanvasSection, CanvasSurface } from "./surfaces";
import { CanvasListView, CanvasView, canvasExtension, canvasPlugin } from "@kb/canvas";
import { canvasBoard } from "./board";
import {
  BoardService,
  BrowserHostService,
  provideRoute,
  provideView,
  RoutePoint,
  SidebarSectionPoint,
  ViewPoint,
} from "@kb/ui-sdk";

/**
 * Canvases: the list and one canvas (its own viewport, so `fixed`), their
 * routes, the section, and the page's board (`BoardService`): a node's
 * board is its child canvas.
 *
 * It is the canvas family's page entry, so it loads the family's shared
 * plugin as a child: the canvas views' keys reach the page kernel's catalog
 * from the family, as the server's do.
 */
export const canvasUiPlugin = definePlugin({
  name: canvasExtension.name,
  tags: familyTags(canvasExtension, "ui"),
  inject: [BrowserHostService],
  apply: (ctx) =>
    Effect.all(
      [
        ctx.plugin(canvasPlugin()),
        Effect.flatMap(ctx.get(BrowserHostService), (host) =>
          ctx.provide(BoardService, canvasBoard(host)),
        ),
        ctx.contribute(
          ViewPoint,
          provideView(CanvasListView, {
            placements: ["page"],
            sample: {},
            Component: CanvasListSurface,
          }),
        ),
        ctx.contribute(
          ViewPoint,
          provideView(CanvasView, {
            // Its key draws a preview, so it is offered at `preview` too: a still picture.
            placements: ["page"],
            picker: { order: 0, icon: SquareIcon },
            sample: { id: "canvas.contract-sample" },
            Component: CanvasSurface,
          }),
        ),
        ctx.contribute(
          RoutePoint,
          provideRoute({
            view: CanvasListView,
            match: matchCanvasList,
            entry: CANVAS_LIST_PATH,
            frame: () => "fixed",
            pendingTitle: () => "Opening canvas…",
          }),
        ),
        ctx.contribute(
          RoutePoint,
          provideRoute({
            view: CanvasView,
            match: matchCanvas,
            frame: () => "fixed",
            pendingTitle: () => "Opening canvas…",
          }),
        ),
        ctx.contribute(SidebarSectionPoint, {
          id: "section",
          value: { order: 30, Component: CanvasSection },
        }),
      ],
      { discard: true },
    ),
});
