import { NoParams, viewKey } from "./view-key.ts";

/** The Extensions panel's namespace and view key: what a host imports, never the components. */
export const EXTENSIONS_NAMESPACE = "extensions";

/** Every extension the host composes, as `extension.list` reports it, with each one's settings. */
export const ExtensionsView = viewKey(
  `${EXTENSIONS_NAMESPACE}.list`,
  "Extensions",
  NoParams.annotate({
    description:
      "Every extension this kb composes: its switch, trust, contributions, settings and failures. It reads no settings of its own.",
  }),
);
