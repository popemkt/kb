import { NoParams, viewKey } from "./view-key.ts";

/** The Extensions panel's namespace and view key: what a host imports, never the components. */
export const EXTENSIONS_NAMESPACE = "extensions";

/** Every extension the host composes, as `extension.list` reports it. */
export const ExtensionsView = viewKey(
  `${EXTENSIONS_NAMESPACE}.list`,
  "Extensions",
  NoParams.annotate({
    description:
      "Every extension this kb composes: its switch, trust, contributions and failures; its settings are the Settings page's. It reads no settings of its own.",
  }),
);
