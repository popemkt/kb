import { NoParams, viewKey } from "./view-key.ts";

/** The Settings page's namespace and view key: what a host imports, never the components. */
export const SETTINGS_NAMESPACE = "settings";

/**
 * Every setting this kb has, as `settingsOf` reads them for each extension's
 * node, and the device's own preferences (DESIGN-UI.md → Settings).
 */
export const SettingsView = viewKey(
  `${SETTINGS_NAMESPACE}.page`,
  "Settings",
  NoParams.annotate({
    description:
      "Every setting of this kb, grouped by the extension whose node it configures, and this device's light, dark and width. It reads no settings of its own.",
  }),
);
