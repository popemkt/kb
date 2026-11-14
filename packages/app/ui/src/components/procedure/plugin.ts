import { Effect } from "effect";
import { coreExtension } from "@kb/operations";
import { familyTags } from "@kb/contracts";
import { definePlugin } from "@kb/plugin";
import { ProcedureView, type ProcedureParams } from "@kb/views";
import { provideRoute, provideView, RoutePoint, ViewPoint } from "@kb/ui-sdk";

/** `/procedure/<id>` names the same contributed procedure the CLI and MCP walk. */
function matchProcedure(path: string): ProcedureParams | null {
  const id = /^\/procedure\/([^/]+)\/?$/.exec(path)?.[1];
  if (id === undefined) return null;
  try {
    return { id: decodeURIComponent(id) };
  } catch {
    return null;
  }
}

import { ProcedureSurface } from "./procedure-lazy";

export const procedureUiPlugin = definePlugin({
  name: "procedure",
  tags: familyTags(coreExtension, "ui"),
  apply: (ctx) =>
    Effect.all(
      [
        ctx.contribute(
          ViewPoint,
          provideView(ProcedureView, {
            placements: ["page"],
            sample: { id: "example" },
            Component: ProcedureSurface,
          }),
        ),
        ctx.contribute(
          RoutePoint,
          provideRoute({
            view: ProcedureView,
            match: matchProcedure,
            frame: () => "scroll",
            pendingTitle: () => "Reading procedure…",
          }),
        ),
      ],
      { discard: true },
    ),
});
