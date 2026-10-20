import { Effect } from "effect";
import { coreExtension } from "@kb/operations";
import { familyTags } from "@kb/contracts";
import { definePlugin } from "@kb/plugin";
import { EXTENSIONS_NAMESPACE, ExtensionsView } from "@kb/views";
import { provideRoute, provideView, RoutePoint, SidebarSectionPoint, ViewPoint } from "@kb/ui-sdk";
import { ExtensionsPage, ExtensionsSection } from "@/components/prefs/extensions-page";
import { EXTENSIONS_PATH } from "@/lib/extension-report";

/** The Extensions panel: its page, its route and its sidebar row. */
export const extensionsUiPlugin = definePlugin({
  name: EXTENSIONS_NAMESPACE,
  tags: familyTags(coreExtension, "ui"),
  apply: (ctx) =>
    Effect.all(
      [
        ctx.contribute(
          ViewPoint,
          provideView(ExtensionsView, {
            placements: ["page"],
            sample: {},
            Component: ExtensionsPage,
          }),
        ),
        ctx.contribute(
          RoutePoint,
          provideRoute({
            view: ExtensionsView,
            match: (path) =>
              path === EXTENSIONS_PATH || path === `${EXTENSIONS_PATH}/` ? {} : null,
            entry: EXTENSIONS_PATH,
            frame: () => "scroll",
            pendingTitle: () => "Opening extensions…",
          }),
        ),
        ctx.contribute(SidebarSectionPoint, {
          id: "section",
          value: { order: 120, Component: ExtensionsSection },
        }),
      ],
      { discard: true },
    ),
});
