import { Effect } from "effect";
import { coreExtension } from "@kb/operations";
import { familyTags } from "@kb/contracts";
import { definePlugin } from "@kb/plugin";
import { SETTINGS_NAMESPACE, SettingsView } from "@kb/views";
import { provideRoute, provideView, RoutePoint, SETTINGS_PATH, ViewPoint } from "@kb/ui-sdk";
import { LazySettingsPage } from "@/components/prefs/settings-lazy";

/**
 * Settings (DESIGN-UI.md → Settings): its page and its route. Its way in is
 * the header's gear (`SettingsTrigger`) and the command palette's Settings.
 */
export const settingsUiPlugin = definePlugin({
  name: SETTINGS_NAMESPACE,
  tags: familyTags(coreExtension, "ui"),
  apply: (ctx) =>
    Effect.all(
      [
        ctx.contribute(
          ViewPoint,
          provideView(SettingsView, {
            placements: ["page"],
            sample: {},
            Component: LazySettingsPage,
          }),
        ),
        ctx.contribute(
          RoutePoint,
          provideRoute({
            view: SettingsView,
            match: (path) => (path === SETTINGS_PATH || path === `${SETTINGS_PATH}/` ? {} : null),
            entry: SETTINGS_PATH,
            frame: () => "scroll",
            pendingTitle: () => "Opening settings…",
          }),
        ),
      ],
      { discard: true },
    ),
});
