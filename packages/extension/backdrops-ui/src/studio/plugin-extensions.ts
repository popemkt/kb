/**
 * The repository extensions Backdrop Studio speaks of (DESIGN-UI.md →
 * Backdrop Studio → From plugins): the server's report (`extension.list`),
 * every row of which with an `origin` is one, its own, linked or
 * installed. It is read again whenever the page's kernel moves, since
 * trusting, removing or switching one moves it.
 */
import { useEffect, useState } from "react";
import { ExtensionReportSchema, type ExtensionReportRow } from "@kb/contracts";
import { browserHost, subscribeUiKernel } from "@kb/ui-sdk";

export interface PluginExtensions {
  /** The repository extensions by name: a backdrop its family is one of these is a plugin's. */
  readonly rows: ReadonlyMap<string, ExtensionReportRow>;
  /**
   * The ones not trusted that have a page half, or whose reach is not known:
   * kb runs none of their code, so the backdrops they may bring are unknown
   * until a person trusts them.
   */
  readonly awaiting: readonly ExtensionReportRow[];
}

const NONE: PluginExtensions = { rows: new Map(), awaiting: [] };

/** The report's repository extensions; none where it cannot be read, as with no server to ask. */
function pluginExtensionsOf(report: unknown): PluginExtensions {
  const parsed = ExtensionReportSchema.safeParse(report);
  if (!parsed.success) return NONE;
  const plugins = parsed.data.extensions.filter((row) => row.origin !== undefined);
  return {
    rows: new Map(plugins.map((row) => [row.name, row])),
    awaiting: plugins.filter((row) => row.trusted === false && row.reach?.page !== false),
  };
}

/** The family a contribution's owner belongs to: the plugin's own name, or the family that loaded it. */
export function familyOf(owner: string): string {
  return owner.split("/")[0] ?? owner;
}

/** Where the report says an extension comes from: what was installed, else its kind of folder. */
export function sourceOf(row: ExtensionReportRow): string {
  const { origin } = row;
  if (origin === undefined) return row.source;
  if (origin.kind === "install") return origin.selection.original;
  if (origin.kind === "link") return `a folder linked in the ${origin.scope} scope`;
  return "this kb's own .kb/extensions";
}

export function usePluginExtensions(): PluginExtensions {
  const [read, setRead] = useState<PluginExtensions>(NONE);
  useEffect(() => {
    let live = true;
    // A burst of kernel moves is one read in flight and, if any moved during it, one more after.
    let asking = false;
    let again = false;
    const ask = () => {
      if (asking) {
        again = true;
        return;
      }
      asking = true;
      const settle = (next: PluginExtensions) => {
        asking = false;
        if (!live) return;
        setRead(next);
        if (again) {
          again = false;
          ask();
        }
      };
      browserHost()
        .invoke("extension.list", {})
        .then((receipt) =>
          settle(receipt.status === "succeeded" ? pluginExtensionsOf(receipt.output) : NONE),
        )
        .catch(() => settle(NONE));
    };
    ask();
    const unsubscribe = subscribeUiKernel(ask);
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  return read;
}
