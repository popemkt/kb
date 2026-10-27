import { Schema } from "effect";
import { viewKey } from "./view-key.ts";

/** The Settings page's namespace and view key: what a host imports, never the components. */
export const SETTINGS_NAMESPACE = "settings";

/** The parts of the Settings page, in the order its rail lists them; the first is where it opens. */
export const SETTINGS_PARTS = ["general", "appearance", "extensions", "advanced"] as const;
export type SettingsPart = (typeof SETTINGS_PARTS)[number];

/** Which part the page shows: General where none is named. */
export const SettingsParams = Schema.Struct({
  part: Schema.optionalKey(Schema.Literals(SETTINGS_PARTS)),
}).annotate({
  description:
    "Which part of Settings it shows: general (this device's width and sidebar, and any setting of core's no other part draws), appearance (light and dark, the theme, the page head, motion and effects), extensions (each extension's switch, its settings and what it composes) or advanced (the listeners asked in turn, the repository extensions refused). General when none is named.",
});
export type SettingsParams = typeof SettingsParams.Type;

/**
 * Every setting this kb has, as `settingsOf` reads them for each extension's
 * node, each extension's switch, and the device's own preferences, in parts
 * (DESIGN-UI.md → Settings).
 */
export const SettingsView = viewKey(`${SETTINGS_NAMESPACE}.page`, "Settings", SettingsParams);
