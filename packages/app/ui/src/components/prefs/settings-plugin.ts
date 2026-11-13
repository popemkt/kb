import { Effect } from "effect";
import { coreExtension } from "@kb/operations";
import { familyTags } from "@kb/contracts";
import { definePlugin } from "@kb/plugin";
import { SETTINGS_NAMESPACE, SettingsView } from "@kb/views";
import { ActionReviewPoint, provideRoute, provideView, RoutePoint, ViewPoint } from "@kb/ui-sdk";
import { SETTINGS_PATH } from "@/lib/settings-trigger";
import { LazySettingsPage } from "@/components/prefs/settings-lazy";
import { PART_WORDS, settingsPartOf } from "@/lib/settings-parts";

/**
 * Settings (DESIGN-UI.md → Settings): its page, and its route, which owns
 * every part's path and the paths the page had before. Its ways in are the
 * header's gear (`SettingsTrigger`), the one on screen, and ⌘K's Settings
 * and Settings: Extensions.
 */
export const settingsUiPlugin = definePlugin({
  name: SETTINGS_NAMESPACE,
  tags: familyTags(coreExtension, "ui"),
  apply: (ctx) =>
    Effect.all(
      [
        ctx.contribute(ActionReviewPoint, {
          id: "sandbox.trust",
          value: {
            action: "sandbox.trust",
            read: (invocation) =>
              import("./extension-approval-read").then(({ readExtensionApproval }) =>
                readExtensionApproval(invocation),
              ),
          },
        }),
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
            match: (path) => {
              const part = settingsPartOf(path);
              return part === null ? null : { part };
            },
            entry: SETTINGS_PATH,
            frame: () => "scroll",
            pendingTitle: ({ part }) =>
              `Opening ${part === undefined ? "settings" : PART_WORDS[part].label.toLowerCase()}…`,
          }),
        ),
      ],
      { discard: true },
    ),
});
